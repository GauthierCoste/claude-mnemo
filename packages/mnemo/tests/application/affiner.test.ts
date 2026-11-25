import { describe, expect, it } from 'vitest';
import { AFFINEES_MAX, affiner, BUDGET_AFFINAGE_MS, CANDIDATES_AFFINEES, candidatesAffinees, morceaux } from '../../src/application/affiner.ts';
import type { DemandeAffinage } from '../../src/application/affiner.ts';
import type { LigneDeClassement } from '../../src/application/classement-du-message.ts';
import type { Affinage, Classe, Dependances, OptionsModele } from '../../src/application/ports.ts';

const ligne = (i: number, surcharge: Partial<LigneDeClassement> = {}): LigneDeClassement => ({
	chemin: `notes/f${i}.md`,
	titre: `Fiche ${i}`,
	note: 0.9 - i / 100,
	p: null,
	signaux: { cosinus: 0.9 - i / 100, cosinusRelatif: 0.1, cosinusZ: 1, bm25Relatif: null, signalSession: 0, apriori: 0 },
	logit: null,
	deja: null,
	raison: null,
	piste: false,
	...surcharge,
});

type Appel = { requete: string; textes: string[]; options: OptionsModele };

/** Dépendances réduites à ce que lit l'affinage ; le reranker note chaque texte par `logitDe`, après `delaiMs`. */
function dependances(options: { logitDe?: (texte: string) => number; delaiMs?: number; sens?: boolean; reranker?: boolean } = {}) {
	const appels: Appel[] = [];
	const appelsSens: string[][] = [];
	const ecrits: string[] = [];
	const dep = {
		sens: {
			modele: () => (options.sens === false ? null : 'faux@1'),
			vecteurs: async (textes: string[]) => {
				appelsSens.push(textes);
				return textes.map(() => new Float32Array([1, 0]));
			},
		},
		reranker: {
			async noter(requete: string, textes: string[], o: OptionsModele) {
				appels.push({ requete, textes, options: o });
				if (options.reranker === false) return null;
				const delai = options.delaiMs ?? 0;
				if (delai > 0) {
					await new Promise((r) => setTimeout(r, Math.min(delai, o.budgetMs)));
					if (delai > o.budgetMs) return null;
				}
				return textes.map((t) => options.logitDe?.(t) ?? 0);
			},
		},
		index: {
			elements: async ({ chemins }: { chemins: string[] }) => chemins.map((chemin) => ({ chemin, texte: `texte de ${chemin}` })),
			fiches: async () => Array.from({ length: 40 }, (_, i) => ({ chemin: `notes/f${i}.md` })),
			// la fiche 5 est la plus proche du sens
			plusProches: async () => Array.from({ length: 40 }, (_, i) => ({ id: `notes/f${i}.md`, similarite: i === 5 ? 0.95 : 0.5 - i / 200 })),
		},
		// tout le reste : jamais appelé (ni injection, ni piste, ni journal)
		...Object.fromEntries(['coffre', 'depot', 'verrou', 'sessions', 'documents', 'lots'].map((n) => [n, new Proxy({}, { get: () => () => ecrits.push(n) })])),
	} as unknown as Dependances;
	return { dep, appels, appelsSens, ecrits };
}

/** L'état : l'entrée la plus récente de la session, à cet horodatage ; une entrée plus récente (`suivante`) rend caduc. */
function etatFaux(horodatageMs: number) {
	const ecritures: { classement: Classe[]; affinage: Affinage | null; sens: boolean }[] = [];
	const etat = {
		suivante: false,
		ecritures,
		async completerClassement(session: string, h: number, classement: Classe[], affinage: Affinage | null, options?: { sens?: boolean }) {
			if (etat.suivante || session !== 's1' || h !== horodatageMs) return false;
			ecritures.push({ classement, affinage, sens: options?.sens === true });
			return true;
		},
	};
	return etat;
}

const demande = (surcharge: Partial<DemandeAffinage> = {}): DemandeAffinage => ({
	session: 's1',
	horodatageMs: 100,
	rang: 3,
	requete: 'le devis des vitraux',
	classement: Array.from({ length: 40 }, (_, i) => ligne(i)),
	sens: true,
	...surcharge,
});

describe('candidatesAffinees', () => {
	it(`les ${CANDIDATES_AFFINEES} premières de l'ordre, plus les désignées par un signal plus loin ; ${AFFINEES_MAX} au plus`, () => {
		const designee = (i: number) => ligne(i, { signaux: { ...ligne(i).signaux, signalSession: 0.3 } });
		const c = candidatesAffinees(Array.from({ length: 40 }, (_, i) => (i === 35 ? designee(i) : ligne(i))));
		expect(c).toHaveLength(CANDIDATES_AFFINEES + 1);
		expect(c.at(-1)).toBe('notes/f35.md');
		expect(candidatesAffinees(Array.from({ length: 60 }, (_, i) => designee(i)))).toHaveLength(AFFINEES_MAX);
	});
});

describe('morceaux', () => {
	it('un seul pour peu de candidates ; sinon des morceaux de 10 ; l’estimation à faire : d’abord 5 et 8 (tailles différentes)', () => {
		expect(morceaux(0, true)).toEqual([]);
		expect(morceaux(7, true)).toEqual([[0, 7]]);
		expect(morceaux(10, false)).toEqual([[0, 10]]);
		expect(morceaux(30, false)).toEqual([[0, 10], [10, 10], [20, 10]]);
		expect(morceaux(30, true)).toEqual([[0, 5], [5, 8], [13, 10], [23, 7]]);
		expect(morceaux(12, true)).toEqual([[0, 5], [5, 7]]);
	});
});

describe('affiner', () => {
	it('reclasse les 30 premières en trois morceaux de 10 : en cours puis fait, même entrée, diffusée à chaque écriture ; rang du hook gardé ; rien d’autre', async () => {
		// le reranker préfère la fiche 20 (loin dans l'ordre du hook)
		const { dep, appels, ecrits } = dependances({ logitDe: (t) => (t.includes('Fiche 20') ? 4 : -1) });
		const etat = etatFaux(100);
		let diffusions = 0;
		const r = await affiner(dep, etat, demande(), {
			diffuser: async () => {
				diffusions++;
			},
		});
		expect(etat.ecritures.map((e) => e.affinage)).toEqual(['en_cours', 'fait']);
		// en cours : le classement du hook tel quel
		expect(etat.ecritures[0]!.classement[0]!.id).toBe('notes/f0.md');
		expect(r!.classement[0]).toMatchObject({ id: 'notes/f20.md', rang: 1, rangHook: 21, signaux: { logit: 4 } });
		expect(r!.classement[1]).toMatchObject({ id: 'notes/f0.md', rang: 2, rangHook: 1 });
		// les notées d'abord (30), puis les autres dans leur ordre
		expect(r!.classement.filter((l) => l.signaux?.logit !== undefined)).toHaveLength(CANDIDATES_AFFINEES);
		expect(r!.classement[CANDIDATES_AFFINEES]!.id).toBe('notes/f30.md');
		expect(appels.map((a) => a.textes.length)).toEqual([10, 10, 10]);
		expect(appels[0]!.options).toMatchObject({ demarrer: false, activite: { operation: 'injection' } });
		expect(appels[0]!.options.budgetMs).toBeLessThanOrEqual(BUDGET_AFFINAGE_MS);
		expect(appels[0]!.textes[0]).toContain('Fiche 0');
		expect(r!.vecteur).toBeNull();
		expect(etat.ecritures[1]!.sens).toBe(false);
		expect(diffusions).toBe(2);
		expect(ecrits).toEqual([]);
	});

	it('les notes du hook sont gardées, jamais recalculées : seules les autres candidates sont soumises', async () => {
		const lignes = Array.from({ length: 12 }, (_, i) => ligne(i, i < 3 ? { logit: 2 } : {}));
		const { dep, appels } = dependances({ logitDe: () => -1 });
		const r = await affiner(dep, etatFaux(100), demande({ classement: lignes }));
		expect(appels.map((a) => a.textes.length)).toEqual([9]);
		expect(appels[0]!.textes.some((t) => t.includes('Fiche 0'))).toBe(false);
		expect(r!.classement.slice(0, 3).map((l) => [l.id, l.signaux?.logit])).toEqual([
			['notes/f0.md', 2],
			['notes/f1.md', 2],
			['notes/f2.md', 2],
		]);
	});

	it('estimation à faire : les premiers morceaux de 5 puis 8, mêmes notes', async () => {
		const { dep, appels } = dependances({ logitDe: (t) => (t.includes('Fiche 20') ? 4 : -1) });
		const r = await affiner(dep, etatFaux(100), demande({ mesurer: true }));
		expect(appels.map((a) => a.textes.length)).toEqual([5, 8, 10, 7]);
		expect(r!.classement[0]).toMatchObject({ id: 'notes/f20.md', signaux: { logit: 4 } });
	});

	it('caduc avant de commencer : rien n’est écrit ni diffusé, aucun appel', async () => {
		const { dep, appels } = dependances();
		const etat = etatFaux(100);
		etat.suivante = true;
		let diffusions = 0;
		expect(await affiner(dep, etat, demande(), { diffuser: async () => void diffusions++ })).toBeNull();
		expect(etat.ecritures).toEqual([]);
		expect(appels).toEqual([]);
		expect(diffusions).toBe(0);
	});

	it('coupé par une demande plus récente pendant un morceau : pas de morceau suivant, l’entrée revient sans état d’affinage', async () => {
		const { dep, appels } = dependances({ delaiMs: 30, logitDe: () => 4 });
		const etat = etatFaux(100);
		const controle = new AbortController();
		const enCours = affiner(dep, etat, demande(), { signal: controle.signal });
		await new Promise((r) => setTimeout(r, 10));
		controle.abort();
		expect(await enCours).toBeNull();
		expect(appels).toHaveLength(1);
		expect(etat.ecritures.map((e) => e.affinage)).toEqual(['en_cours', null]);
		expect(etat.ecritures[1]!.classement).toEqual(etat.ecritures[0]!.classement);
	});

	it('caduc à l’écriture finale (un message plus récent, journalisé hors service) : rien de plus n’est écrit', async () => {
		const { dep } = dependances({ delaiMs: 20 });
		const etat = etatFaux(100);
		let diffusions = 0;
		const enCours = affiner(dep, etat, demande(), { diffuser: async () => void diffusions++ });
		await new Promise((r) => setTimeout(r, 5));
		etat.suivante = true;
		expect(await enCours).toBeNull();
		expect(etat.ecritures.map((e) => e.affinage)).toEqual(['en_cours']);
	});

	it('budget dépassé : sans notes ajoutées, l’entrée garde le classement du hook, sans état d’affinage', async () => {
		const { dep, appels } = dependances({ delaiMs: 200, logitDe: () => 4 });
		const etat = etatFaux(100);
		const debut = Date.now();
		expect(await affiner(dep, etat, demande({ budgetMs: 50 }))).toBeNull();
		expect(Date.now() - debut).toBeLessThan(150);
		expect(appels).toHaveLength(1);
		expect(appels[0]!.options.budgetMs).toBeLessThanOrEqual(50);
		expect(etat.ecritures.map((e) => e.affinage)).toEqual(['en_cours', null]);
		expect(etat.ecritures[1]!.classement.map((l) => l.id)).toEqual(demande().classement.map((l) => l.chemin));
	});

	it('estimation plus longue que le budget restant : aucun appel, rien d’ajouté', async () => {
		const { dep, appels } = dependances({ logitDe: () => 4 });
		const etat = etatFaux(100);
		expect(await affiner(dep, etat, demande(), { estimer: () => BUDGET_AFFINAGE_MS + 1 })).toBeNull();
		expect(appels).toEqual([]);
		expect(etat.ecritures.map((e) => e.affinage)).toEqual(['en_cours', null]);
	});

	it('sens absent au hook : l’affinage calcule les cosinus (la plus proche monte) et le vecteur, noté sens ; puis le reranker', async () => {
		const lignes = Array.from({ length: 40 }, (_, i) => ligne(i, { note: null, signaux: { ...ligne(i).signaux, cosinus: null, cosinusRelatif: null, cosinusZ: null } }));
		const { dep, appels, appelsSens } = dependances({ reranker: false });
		const etat = etatFaux(100);
		const r = await affiner(dep, etat, demande({ sens: false, classement: lignes }));
		expect(appelsSens).toEqual([['le devis des vitraux']]);
		expect(r!.classement[0]).toMatchObject({ id: 'notes/f5.md', signaux: { cosinus: 0.95 } });
		expect(r!.classement[0]!.signaux!.cosinusZ).toBeGreaterThan(0);
		expect(r!.vecteur?.modele).toBe('faux@1');
		expect(etat.ecritures.at(-1)).toMatchObject({ affinage: 'fait', sens: true });
		// soumises au reranker dans le nouvel ordre (il ne répond pas ici)
		expect(appels[0]!.textes[0]).toContain('Fiche 5');
	});

	it('le sens seul (reranker pas en marche) : aucun appel au reranker', async () => {
		const lignes = Array.from({ length: 12 }, (_, i) => ligne(i, { note: null, signaux: { ...ligne(i).signaux, cosinus: null, cosinusRelatif: null, cosinusZ: null } }));
		const { dep, appels } = dependances();
		const r = await affiner(dep, etatFaux(100), demande({ sens: false, classement: lignes }), { reranker: false });
		expect(appels).toEqual([]);
		expect(r!.classement[0]!.id).toBe('notes/f5.md');
	});
});
