import { describe, expect, it } from 'vitest';
import { affiner, BUDGET_AFFINAGE_MS, CANDIDATES_AFFINEES, candidatesAffinees, morceaux } from '../../src/application/affiner.ts';
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
	const ecritures: { classement: Classe[]; affinage: Affinage }[] = [];
	const etat = {
		suivante: false,
		ecritures,
		async completerClassement(session: string, h: number, classement: Classe[], affinage: Affinage) {
			if (etat.suivante || session !== 's1' || h !== horodatageMs) return false;
			ecritures.push({ classement, affinage });
			return true;
		},
	};
	return etat;
}

const demande = (surcharge: Partial<DemandeAffinage> = {}): DemandeAffinage => ({
	session: 's1',
	horodatageMs: 100,
	requete: 'le devis des vitraux',
	classement: Array.from({ length: 40 }, (_, i) => ligne(i)),
	sens: true,
	...surcharge,
});

describe('candidatesAffinees', () => {
	it(`les ${CANDIDATES_AFFINEES} premières de l'ordre, plus les désignées par un signal plus loin`, () => {
		const lignes = Array.from({ length: 40 }, (_, i) => ligne(i, i === 35 ? { signaux: { ...ligne(35).signaux, signalSession: 0.3 } } : {}));
		const c = candidatesAffinees(lignes);
		expect(c).toHaveLength(CANDIDATES_AFFINEES + 1);
		expect(c.at(-1)).toBe('notes/f35.md');
	});
});

describe('morceaux', () => {
	it('un appel ; ou trois morceaux, 8, 5 puis le reste, quand l’estimation est à faire', () => {
		expect(morceaux(30, false)).toEqual([[0, 30]]);
		expect(morceaux(30, true)).toEqual([[0, 8], [8, 5], [13, 17]]);
		// moins de candidates : toujours trois appels (trois mesures), tant qu'il y en a trois
		expect(morceaux(14, true)).toEqual([[0, 8], [8, 5], [13, 1]]);
		expect(morceaux(10, true)).toEqual([[0, 8], [8, 1], [9, 1]]);
		expect(morceaux(3, true)).toEqual([[0, 1], [1, 1], [2, 1]]);
		expect(morceaux(2, true)).toEqual([[0, 1], [1, 1]]);
		expect(morceaux(1, true)).toEqual([[0, 1]]);
		expect(morceaux(0, true)).toEqual([]);
	});
});

describe('affiner', () => {
	it('reclasse les 30 premières par le reranker : en cours, puis fait, même entrée ; diffusé une fois ; rien d’autre', async () => {
		// le reranker préfère la fiche 20 (loin dans l'ordre du hook)
		const { dep, appels, ecrits } = dependances({ logitDe: (t) => (t.includes('Fiche 20') ? 4 : -1) });
		const etat = etatFaux(100);
		let diffusions = 0;
		const affine = await affiner(dep, etat, demande(), async () => {
			diffusions++;
		});
		expect(etat.ecritures.map((e) => e.affinage)).toEqual(['en_cours', 'fait']);
		// en cours : le classement du hook tel quel
		expect(etat.ecritures[0]!.classement[0]!.id).toBe('notes/f0.md');
		expect(affine![0]).toMatchObject({ id: 'notes/f20.md', rang: 1, signaux: { logit: 4 } });
		// les notées d'abord (30), puis les autres dans leur ordre
		expect(affine!.filter((l) => l.signaux?.logit !== undefined)).toHaveLength(CANDIDATES_AFFINEES);
		expect(affine![CANDIDATES_AFFINEES]!.id).toBe('notes/f30.md');
		expect(appels).toHaveLength(1);
		expect(appels[0]!.textes).toHaveLength(CANDIDATES_AFFINEES);
		expect(appels[0]!.options).toMatchObject({ demarrer: false, activite: { operation: 'injection' } });
		expect(appels[0]!.options.budgetMs).toBeLessThanOrEqual(BUDGET_AFFINAGE_MS);
		expect(appels[0]!.textes[0]).toContain('Fiche 0');
		expect(diffusions).toBe(1);
		expect(ecrits).toEqual([]);
	});

	it('estimation à faire : l’appel en morceaux de 8, 5 puis le reste, mêmes notes', async () => {
		const { dep, appels } = dependances({ logitDe: (t) => (t.includes('Fiche 20') ? 4 : -1) });
		const affine = await affiner(dep, etatFaux(100), demande({ mesurer: true }));
		expect(appels.map((a) => a.textes.length)).toEqual([8, 5, 17]);
		expect(affine![0]).toMatchObject({ id: 'notes/f20.md', signaux: { logit: 4 } });
	});

	it('caduc : une entrée plus récente dans la session → rien n’est écrit ni diffusé', async () => {
		const { dep, appels } = dependances();
		const etat = etatFaux(100);
		etat.suivante = true;
		let diffusions = 0;
		expect(await affiner(dep, etat, demande(), async () => void diffusions++)).toBeNull();
		expect(etat.ecritures).toEqual([]);
		expect(appels).toEqual([]);
		expect(diffusions).toBe(0);
	});

	it('caduc pendant le reranker : en cours écrit, le résultat ni écrit ni diffusé', async () => {
		const { dep } = dependances({ delaiMs: 20 });
		const etat = etatFaux(100);
		let diffusions = 0;
		const enCours = affiner(dep, etat, demande(), async () => void diffusions++);
		await new Promise((r) => setTimeout(r, 5));
		etat.suivante = true;
		expect(await enCours).toBeNull();
		expect(etat.ecritures.map((e) => e.affinage)).toEqual(['en_cours']);
		expect(diffusions).toBe(0);
	});

	it('budget dépassé : sans notes du reranker, le classement du hook, fait', async () => {
		const { dep, appels } = dependances({ delaiMs: 200, logitDe: () => 4 });
		const etat = etatFaux(100);
		const debut = Date.now();
		const affine = await affiner(dep, etat, demande({ budgetMs: 50 }));
		expect(Date.now() - debut).toBeLessThan(150);
		expect(appels[0]!.options.budgetMs).toBeLessThanOrEqual(50);
		expect(affine!.map((l) => l.id)).toEqual(demande().classement.map((l) => l.chemin));
		expect(affine!.some((l) => l.signaux?.logit !== undefined)).toBe(false);
		expect(etat.ecritures.map((e) => e.affinage)).toEqual(['en_cours', 'fait']);
	});

	it('sens absent au hook : l’affinage calcule les cosinus (la plus proche monte), puis le reranker', async () => {
		const lignes = Array.from({ length: 40 }, (_, i) => ligne(i, { note: null, signaux: { ...ligne(i).signaux, cosinus: null, cosinusRelatif: null, cosinusZ: null } }));
		const { dep, appels, appelsSens } = dependances({ reranker: false });
		const affine = await affiner(dep, etatFaux(100), demande({ sens: false, classement: lignes }));
		expect(appelsSens).toEqual([['le devis des vitraux']]);
		expect(affine![0]).toMatchObject({ id: 'notes/f5.md', signaux: { cosinus: 0.95 } });
		expect(affine![0]!.signaux!.cosinusZ).toBeGreaterThan(0);
		// soumises au reranker dans le nouvel ordre
		expect(appels[0]!.textes[0]).toContain('Fiche 5');
	});
});
