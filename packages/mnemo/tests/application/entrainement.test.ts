import { describe, expect, it, vi } from 'vitest';
import type { CasContexte, Prejugement } from '../../src/application/banc-contexte.ts';
import type { BilanExtraction, MessageAExtraire } from '../../src/application/banc-extraire.ts';
import type { RapportDApprentissage } from '../../src/application/apprendre-note.ts';
import { creerEntrainement, ErreurEntrainement, HISTORIQUE_MAX } from '../../src/application/entrainement.ts';
import type { LigneHistorique, PortsEntrainement } from '../../src/application/entrainement.ts';
import { modeleNonAppris, REFUS_DEPART } from '../../src/domaine/modele-de-note.ts';
import type { CoefficientsNote, ModeleDeNote } from '../../src/domaine/modele-de-note.ts';
import type { ModelesDeNote } from '../../src/domaine/note-de-confiance.ts';

const MAINTENANT = new Date('2026-11-26T10:00:00.000Z');

const unCas = (nom: string, chemins: string[], extra: Partial<CasContexte> = {}): CasContexte => ({
	nom,
	position: 'p',
	message: `message ${nom} sur le budget annuel du projet alpha et ses échéances principales`,
	premier: false,
	attendues: [],
	interdites: [],
	silence: false,
	session: `s-${nom}`,
	rang: 1,
	candidates: chemins.map((chemin) => ({ chemin, titre: `Titre ${chemin}`, ligne: `ligne ${chemin}`, listes: ['sens'], signaux: {} })),
	jugements: {},
	...extra,
});

const appris = (extra: Partial<ModeleDeNote> = {}): ModeleDeNote => ({ ...modeleNonAppris(), apprisLe: '2026-11-20T10:00:00.000Z', poids: { cosinusRelatif: 1 }, refus: [], ...extra });

/** Une promesse tenue en main : le test la résout quand il veut. */
function enMain<T>() {
	let resoudre!: (v: T) => void;
	const promesse = new Promise<T>((r) => (resoudre = r));
	return { promesse, resoudre };
}

const MESSAGES: MessageAExtraire[] = Array.from({ length: 3 }, (_, i) => ({ session: `j${i}`, groupe: '', rang: 1, horodatageMs: i, message: `nouveau ${i}`, position: 'p', precedent: null }));
const bilan = (cas: CasContexte[]): BilanExtraction => ({ cas, sansCandidate: 0, sansModele: 0, modeles: { sens: true, reranker: true } });

/** Ports factices : fichier des jugements en mémoire (copie à chaque lecture), verrou noté, fichiers de la note en mémoire. */
function faux(cas: CasContexte[], o: Partial<PortsEntrainement> & { modeles?: ModelesDeNote; avant?: boolean } = {}) {
	const etat = {
		fichier: structuredClone(cas),
		verrou: null as string | null,
		prises: [] as string[],
		/** Opération qui tient le verrou ailleurs (le CLI) : toute prise est refusée. */
		ailleurs: null as string | null,
		ecritures: 0,
		coefficients: [] as CoefficientsNote[],
		rapports: [] as { rapport: RapportDApprentissage; remplace: boolean }[],
		avant: o.avant ?? false,
		retours: 0,
		historique: [] as LigneHistorique[],
		changements: 0,
	};
	const modeles: ModelesDeNote = o.modeles ?? { complets: { modele: modeleNonAppris(), etat: 'non_appris' }, sens: { modele: modeleNonAppris(), etat: 'non_appris' } };
	const ports: PortsEntrainement = {
		banc: {
			lire: async () => structuredClone(etat.fichier),
			ecrire: async (c) => {
				etat.ecritures++;
				etat.fichier = structuredClone([...c]);
			},
			verrouiller: (operation) => {
				if (etat.ailleurs !== null) throw new Error(`Le fichier des jugements est ouvert par « mnemo banc contexte ${etat.ailleurs} »`);
				if (etat.verrou !== null) throw new Error(`déjà tenu par ${etat.verrou}`);
				etat.verrou = operation;
				etat.prises.push(operation);
				return () => {
					etat.verrou = null;
				};
			},
		},
		journal: async () => MESSAGES,
		extraire: async (messages) => bilan(messages.map((m) => unCas(m.message, ['x.md'], { message: m.message, session: m.session }))),
		syntheses: async (chemins) => new Map(chemins.map((c) => [c, `synthèse de ${c} `.repeat(40)])),
		juge: () => ({ raison: 'Claude Code introuvable' }),
		note: {
			modeles: async () => modeles,
			installes: () => ({ sens: 'sens.gguf@1', reranker: 'reranker.gguf@2' }),
			echelle: () => ({ poidsInjection: 1, demiVieInjection: 3, apriori: 'v1' }),
			empreintes: async () => new Map(),
			ecrire: async (c) => {
				etat.coefficients.push(c);
				etat.avant = true;
			},
			ecrireRapport: async (rapport, remplace) => {
				etat.rapports.push({ rapport, remplace });
			},
			avant: async () => etat.avant,
			revenir: async () => {
				if (!etat.avant) return false;
				etat.retours++;
				return true;
			},
			rapport: async () => etat.rapports.at(-1) ?? null,
		},
		apprenti: { apprendre: async () => rapportFactice() },
		historique: {
			lire: async () => structuredClone(etat.historique),
			ecrire: async (l) => {
				etat.historique = [...l];
			},
		},
		maintenant: () => MAINTENANT,
		surChangement: () => {
			etat.changements++;
		},
		...o,
	};
	return { etat, ports, e: creerEntrainement(ports) };
}

/** Un rapport réduit à ce que l'entraînement lit : coefficients, niveaux (modèle, fiabilité), date, messages, sessions. */
function rapportFactice(accepte = false): RapportDApprentissage {
	const complets = appris({ accepte, refus: accepte ? [] : ['3 injections simulées (au moins 25)'], paires: 40 });
	const sens = appris({ accepte: false, refus: ['pas assez de messages silence : 2 de 1 sessions réelles (au moins 20 de 5)'], paires: 40 });
	return {
		date: MAINTENANT.toISOString(),
		messages: 12,
		sessions: 4,
		niveaux: [
			{ niveau: 'complets', modele: complets, fiabilite: [{ de: 0, a: 0.1, paires: 3, pMoyen: 0.05, frequence: 0 }] },
			{ niveau: 'sens', modele: sens, fiabilite: [] },
		],
		coefficients: { complets, sens },
	} as unknown as RapportDApprentissage;
}

const valide = (nom: string, chemins: string[]): CasContexte => unCas(nom, chemins, { jugements: Object.fromEntries(chemins.map((c) => [c, 'non_pertinente'])), valideLe: '2026-11-25T10:00:00.000Z' });

describe("entraînement de la note : l'état", () => {
	it('banc, note par niveau avec son verdict et ses critères en clair, juge absent et sa raison, aucune tâche', async () => {
		const prop: Prejugement = { jugement: 'pertinente', confiance: 0.5, raison: 'parle du budget' };
		const cas = [valide('v', ['a.md', 'b.md']), unCas('r', ['a.md'], { prejugements: { 'a.md': prop } }), unCas('j', ['c.md']), unCas('s', ['d.md'], { saute: true })];
		const modeles: ModelesDeNote = {
			complets: { modele: appris({ refus: ['3 injections simulées (au moins 25)'] }), etat: 'refuse' },
			sens: { modele: appris({ origine: 'depart', refus: [REFUS_DEPART] }), etat: 'depart' },
		};
		const { e } = faux(cas, { modeles, avant: true });
		const etat = await e.etat();
		expect(etat.banc).toEqual({ messages: 3, valides: 1, aJuger: 2, aRelire: 1, aPrejuger: 1, silences: 0, sautes: 1, paires: 2 });
		expect(etat.note.avant).toBe(true);
		expect(etat.note.niveaux).toEqual([
			{
				niveau: 'complets',
				etat: 'refuse',
				origine: 'appris',
				date: '2026-11-20T10:00:00.000Z',
				verdict: 'Refusé : la note ordonne le classement, sans %',
				criteres: ['trop peu de fiches au-dessus de 90 % : 3, il en faut 25'],
				refus: ['3 injections simulées (au moins 25)'],
			},
			{
				niveau: 'sens',
				etat: 'depart',
				origine: 'depart',
				date: '2026-11-20T10:00:00.000Z',
				verdict: 'Note de départ, à entraîner : elle ordonne le classement, sans %',
				criteres: ['note de départ livrée avec Mnemo, pas encore entraînée sur tes jugements'],
				refus: [REFUS_DEPART],
			},
		]);
		expect(etat.juge).toEqual({ disponible: false, raison: 'Claude Code introuvable' });
		expect(etat.tache).toBeNull();
		expect(etat.resultat).toBeNull();
		expect(etat.derniereErreur).toBeUndefined();
	});
});

describe('entraînement de la note : une tâche à la fois (D7)', () => {
	it("préparer : la place et le verrou sont pris pour toute la tâche ; une autre tâche est refusée (occupe) ; à la fin, les cas sont ajoutés, tout est rendu", async () => {
		const extraction = enMain<BilanExtraction>();
		const { e, etat } = faux([], { extraire: () => extraction.promesse });
		const { fin } = await e.preparer({ nombre: 2 });
		expect(e.tache()).toMatchObject({ genre: 'preparer', fait: 0, depuis: MAINTENANT.toISOString() });
		await vi.waitFor(() => expect(e.tache()?.total).toBe(2));
		expect(etat.verrou).toBe('préparer des messages');
		await expect(e.apprendre({ origine: 'manuel' })).rejects.toMatchObject({ genre: 'occupe', message: expect.stringMatching(/préparer des messages/u) });
		await expect(e.prejuger()).rejects.toBeInstanceOf(ErreurEntrainement);
		extraction.resoudre(bilan([unCas('n0', ['x.md'])]));
		await fin;
		expect(etat.fichier.map((c) => c.nom)).toEqual(['n0']);
		expect(e.tache()).toBeNull();
		expect(etat.verrou).toBeNull();
		expect((await e.etat()).derniereErreur).toBeUndefined();
	});

	it('le verrou tenu ailleurs (une commande mnemo banc contexte) : la tâche est refusée (occupe) en nommant la commande, et rien ne reste réservé', async () => {
		const { e, etat } = faux([]);
		etat.ailleurs = '--juger';
		await expect(e.preparer()).rejects.toMatchObject({ genre: 'occupe', message: expect.stringMatching(/--juger/u) });
		expect(e.tache()).toBeNull();
		etat.ailleurs = null;
		await (await e.preparer()).fin;
		expect(etat.fichier).toHaveLength(3);
	});

	it('arrêter : la tâche finit sans erreur, ce qui est enregistré le reste ; sans tâche, arrêter rend faux', async () => {
		let appels = 0;
		let arreter = (): boolean => false;
		const { e, etat } = faux([], {
			extraire: async (messages, o) => {
				appels++;
				o.avancement(1, messages.length);
				// l'utilisateur arrête pendant le premier paquet : il est enregistré, aucun autre n'est lancé
				arreter();
				return bilan(messages.map((m) => unCas(m.message, ['x.md'], { message: m.message })));
			},
			journal: async () => Array.from({ length: 25 }, (_, i) => ({ session: `j${i}`, groupe: '', rang: 1, horodatageMs: i, message: `nouveau ${i}`, position: 'p', precedent: null })),
		});
		arreter = () => e.arreter();
		const { fin } = await e.preparer({ nombre: 25 });
		await fin;
		expect(appels).toBe(1);
		expect(etat.fichier).toHaveLength(10);
		expect((await e.etat()).derniereErreur).toBeUndefined();
		expect(e.tache()).toBeNull();
		expect(e.arreter()).toBe(false);
	});

	it("l'échec d'une tâche va dans derniereErreur ; la tâche suivante l'efface", async () => {
		const { e } = faux([], { journal: async () => [] });
		await (await e.preparer()).fin;
		expect((await e.etat()).derniereErreur).toMatch(/Aucun message nouveau/u);
		const autre = faux([], { extraire: async () => Promise.reject(new Error('index fermé')) });
		await (await autre.e.preparer()).fin;
		expect((await autre.e.etat()).derniereErreur).toBe('index fermé');
	});

	it("une écriture en cours (qui tient le verrou un instant) ne fait pas refuser la tâche qui démarre : le verrou de la tâche est pris après elle, dans la file", async () => {
		const ecriture = enMain<void>();
		const { e, etat, ports } = faux([unCas('m', ['a.md'])]);
		const ecrireReel = ports.banc.ecrire;
		let premiere = true;
		ports.banc.ecrire = async (c) => {
			if (premiere) {
				premiere = false;
				await ecriture.promesse;
			}
			await ecrireReel(c);
		};
		const reponse = e.repondre(0, { jugements: { 'a.md': 'pertinente' }, resteNonUtile: true });
		await vi.waitFor(() => expect(etat.verrou).toBe('enregistrer des jugements'));
		const demarrage = e.preparer({ nombre: 1 });
		ecriture.resoudre();
		await reponse;
		await (await demarrage).fin;
		expect(etat.prises).toEqual(['enregistrer des jugements', 'préparer des messages']);
		expect(etat.fichier[0]).toMatchObject({ jugements: { 'a.md': 'pertinente' } });
		expect(etat.verrou).toBeNull();
	});

	it('fermé (arrêt du service) : plus aucune tâche ne démarre', async () => {
		const { e, etat } = faux([valide('v', ['a.md'])]);
		await e.fermer();
		await expect(e.preparer()).rejects.toMatchObject({ genre: 'refuse' });
		await expect(e.apprendre({ origine: 'manuel' })).rejects.toMatchObject({ genre: 'refuse' });
		expect(e.tache()).toBeNull();
		expect(etat.prises).toEqual([]);
	});

	it('pré-juger cherche le juge de nouveau (frais), l’état peut lire celui gardé', async () => {
		const demandes: (boolean | undefined)[] = [];
		const { e } = faux([unCas('m', ['a.md'])], {
			juge: (o) => {
				demandes.push(o?.frais);
				return { raison: 'Claude Code introuvable' };
			},
		});
		await e.etat();
		await expect(e.prejuger()).rejects.toMatchObject({ genre: 'refuse', message: 'Claude Code introuvable' });
		expect(demandes).toEqual([undefined, true]);
	});

	it('fermer arrête la tâche en cours et attend sa fin', async () => {
		const { e } = faux([], {
			extraire: (_, o) => new Promise((_r, rejeter) => o.signal.addEventListener('abort', () => rejeter(Object.assign(new Error('arrêté'), { name: 'AbortError' })))),
		});
		await e.preparer();
		await e.fermer();
		expect(e.tache()).toBeNull();
	});
});

describe("entraînement de la note : la file d'écriture", () => {
	it('une réponse donnée pendant la préparation est gardée : la préparation relit le fichier avant de fusionner', async () => {
		const extraction = enMain<BilanExtraction>();
		const { e, etat } = faux([unCas('m', ['a.md', 'b.md'])], { extraire: () => extraction.promesse });
		const { fin } = await e.preparer({ nombre: 1 });
		// pendant la tâche : pas de seconde prise du verrou (la tâche le tient pour le service)
		await e.repondre(0, { jugements: { 'a.md': 'pertinente' }, resteNonUtile: true });
		expect(etat.prises).toEqual(['préparer des messages']);
		extraction.resoudre(bilan([unCas('n', ['x.md'])]));
		await fin;
		expect(etat.fichier.map((c) => c.nom)).toEqual(['m', 'n']);
		expect(etat.fichier[0]).toMatchObject({ jugements: { 'a.md': 'pertinente', 'b.md': 'non_pertinente' }, valideLe: MAINTENANT.toISOString() });
	});

	it('des réponses lancées ensemble sont toutes écrites (une lecture-écriture à la fois) ; hors tâche, chacune prend le verrou le temps de son écriture', async () => {
		const { e, etat } = faux([unCas('m1', ['a.md']), unCas('m2', ['b.md']), unCas('m3', ['c.md'])]);
		await Promise.all([0, 1, 2].map((i) => e.repondre(i, { jugements: {}, resteNonUtile: true })));
		expect(etat.fichier.map((c) => c.valideLe)).toEqual([MAINTENANT.toISOString(), MAINTENANT.toISOString(), MAINTENANT.toISOString()]);
		expect(etat.prises).toEqual(['enregistrer des jugements', 'enregistrer des jugements', 'enregistrer des jugements']);
		expect(etat.verrou).toBeNull();
		etat.ailleurs = '--juger';
		await expect(e.repondre(0, { jugements: {}, resteNonUtile: true })).rejects.toMatchObject({ genre: 'occupe' });
	});

	it('répondre : indice inconnu (introuvable), silence refusé si une fiche est utile ; rend le prochain message', async () => {
		const { e } = faux([unCas('m1', ['a.md', 'b.md']), unCas('m2', ['c.md'])]);
		await expect(e.repondre(7, { jugements: {}, resteNonUtile: true })).rejects.toMatchObject({ genre: 'introuvable' });
		await expect(e.repondre(0, { jugements: { 'a.md': 'pertinente' }, resteNonUtile: true, silence: true })).rejects.toMatchObject({ genre: 'refuse' });
		expect(await e.repondre(0, { jugements: { 'a.md': 'pertinente' }, resteNonUtile: true })).toEqual({ suivant: 1 });
		expect(await e.repondre(1, { jugements: {}, resteNonUtile: false, silence: true })).toEqual({ suivant: null });
	});

	it('annuler : la dernière réponse, puis la précédente ; « Accepter les sûres » s’annule d’un coup ; pile vide : refusé', async () => {
		const sure: Prejugement = { jugement: 'non_pertinente', confiance: 0.95, raison: 'hors sujet' };
		const cas = [unCas('m1', ['a.md']), unCas('m2', ['b.md'], { prejugements: { 'b.md': sure } }), unCas('m3', ['c.md'], { prejugements: { 'c.md': sure } })];
		const { e, etat } = faux(cas);
		await expect(e.annuler()).rejects.toMatchObject({ genre: 'refuse', message: 'Rien à annuler.' });
		await e.repondre(0, { jugements: { 'a.md': 'pertinente' }, resteNonUtile: true });
		expect(await e.accepterSures()).toEqual({ acceptes: 2 });
		expect(etat.fichier.map((c) => c.valideLe !== undefined)).toEqual([true, true, true]);
		expect(await e.annuler()).toEqual({ indice: 1 });
		expect(etat.fichier.map((c) => c.valideLe !== undefined)).toEqual([true, false, false]);
		expect(await e.annuler()).toEqual({ indice: 0 });
		expect(etat.fichier).toEqual(cas);
		expect(await e.accepterSures()).toEqual({ acceptes: 2 });
		await e.annuler();
		// rien de sûr : rien n'est écrit ni empilé
		const ecritures = etat.ecritures;
		const { e: e2, etat: etat2 } = faux([unCas('m', ['a.md'])]);
		expect(await e2.accepterSures()).toEqual({ acceptes: 0 });
		expect(etat2.ecritures).toBe(0);
		expect(etat.ecritures).toBe(ecritures);
	});

	it('le message à juger : ceux à relire d’abord, candidates dans l’ordre de présentation, synthèse coupée, propositions et jugements, précédent seulement s’il est joint', async () => {
		const prop: Prejugement = { jugement: 'pertinente', confiance: 0.4, raison: 'parle du budget' };
		const cas = [unCas('m1', ['a.md']), unCas('m2', ['b.md', 'c.md'], { message: 'et pour ça ?', precedent: 'Le budget du projet alpha', prejugements: { 'b.md': prop }, jugements: { 'c.md': 'indecise' } })];
		const { e } = faux(cas);
		const m = (await e.message())!;
		expect(m).toMatchObject({ indice: 1, message: 'et pour ça ?', precedent: 'Le budget du projet alpha', valide: false, silence: false, saute: false, aRelire: true, restants: 2 });
		expect(m.candidates.map((x) => x.chemin).sort()).toEqual(['b.md', 'c.md']);
		const b = m.candidates.find((x) => x.chemin === 'b.md')!;
		expect(b).toMatchObject({ titre: 'Titre b.md', ligne: 'ligne b.md', proposition: prop, jugement: null });
		expect([...b.synthese]).toHaveLength(300);
		expect(b.synthese.endsWith('…')).toBe(true);
		expect(m.candidates.find((x) => x.chemin === 'c.md')!.jugement).toBe('indecise');
		// un message long ne joint pas le précédent
		const autre = faux([unCas('long', ['a.md'], { precedent: 'avant' })]);
		expect((await autre.e.message(0))!.precedent).toBeNull();
		await expect(e.message(9)).rejects.toMatchObject({ genre: 'introuvable' });
		const fini = faux([valide('v', ['a.md'])]);
		expect(await fini.e.message()).toBeNull();
	});
});

describe('entraînement de la note : apprendre et revenir (D6)', () => {
	it('sans jugement validé : refusé, rien de réservé', async () => {
		const { e, etat } = faux([unCas('m', ['a.md'])]);
		await expect(e.apprendre({ origine: 'manuel' })).rejects.toMatchObject({ genre: 'refuse' });
		expect(e.tache()).toBeNull();
		expect(etat.verrou).toBeNull();
	});

	it('apprendre : le nouveau modèle écrit (modèle d’avant gardé), le rapport, une ligne d’historique ; le résultat en clair dans l’état', async () => {
		const { e, etat } = faux([valide('v', ['a.md'])]);
		etat.historique = Array.from({ length: HISTORIQUE_MAX }, (_, i) => ({ date: `2026-11-${10 + i}`, origine: 'automatique', verdicts: { complets: 'refuse', sens: 'refuse' }, remplace: false }) as LigneHistorique);
		await (await e.apprendre({ origine: 'manuel' })).fin;
		expect(etat.coefficients).toHaveLength(1);
		expect(etat.rapports.map((r) => r.remplace)).toEqual([true]);
		expect(etat.historique).toHaveLength(HISTORIQUE_MAX);
		expect(etat.historique[0]).toEqual({ date: MAINTENANT.toISOString(), origine: 'manuel', verdicts: { complets: 'refuse', sens: 'refuse' }, remplace: true });
		const vue = await e.etat();
		expect(vue.note.avant).toBe(true);
		expect(vue.resultat).toMatchObject({ date: MAINTENANT.toISOString(), messages: 12, sessions: 4 });
		expect(vue.resultat!.niveaux[0]).toMatchObject({ niveau: 'complets', accepte: false, verdict: 'Refusé : la note ordonne le classement, sans %', criteres: ['trop peu de fiches au-dessus de 90 % : 3, il en faut 25'], paires: 40 });
		expect(vue.resultat!.niveaux[1]!.criteres).toEqual(["trop peu de messages « Rien d'utile ici » : 2 venus de 1 sessions, il en faut 20 venus de 5"]);
		expect(vue.historique[0]!.origine).toBe('manuel');
	});

	it('remplacer refuse le nouveau modèle : seul le rapport est écrit, la ligne et le résultat le disent', async () => {
		const { e, etat } = faux([valide('v', ['a.md'])]);
		await (await e.apprendre({ origine: 'automatique', remplacer: () => false })).fin;
		expect(etat.coefficients).toEqual([]);
		expect(etat.rapports.map((r) => r.remplace)).toEqual([false]);
		expect(etat.historique[0]).toMatchObject({ origine: 'automatique', remplace: false });
		expect((await e.etat()).resultat).toMatchObject({ remplace: false });
	});

	it("à la main, un modèle refusé remplace un modèle accepté (« Revenir au modèle d'avant » le rend) : la ligne, le résultat et l'état le disent", async () => {
		const modeles: ModelesDeNote = { complets: { modele: appris({ accepte: true }), etat: 'accepte' }, sens: { modele: appris({ accepte: true }), etat: 'accepte' } };
		const { e, etat } = faux([valide('v', ['a.md'])], { modeles });
		await (await e.apprendre({ origine: 'manuel' })).fin;
		expect(etat.coefficients).toHaveLength(1);
		expect(etat.historique[0]).toMatchObject({ origine: 'manuel', verdicts: { complets: 'refuse', sens: 'refuse' }, remplace: true });
		const vue = await e.etat();
		expect(vue.resultat).toMatchObject({ remplace: true });
		expect(vue.resultat!.niveaux.map((n) => n.verdict)).toEqual(['Refusé : la note ordonne le classement, sans %', 'Refusé : la note ordonne le classement, sans %']);
		expect(vue.note.avant).toBe(true);
	});

	it('deux retours au modèle d’avant demandés ensemble passent l’un après l’autre', async () => {
		let enCours = 0;
		let chevauchement = false;
		const { e, ports } = faux([], { avant: true });
		ports.note.revenir = async () => {
			enCours++;
			if (enCours > 1) chevauchement = true;
			await new Promise((r) => setTimeout(r, 5));
			enCours--;
			return true;
		};
		await Promise.all([e.revenir(), e.revenir()]);
		expect(chevauchement).toBe(false);
	});

	it('arrêté pendant l’apprentissage : rien n’est écrit ; revenir est refusé pendant un apprentissage', async () => {
		const { e, etat } = faux([valide('v', ['a.md'])], {
			avant: true,
			apprenti: { apprendre: (_j, _o, signal) => new Promise((_r, rejeter) => signal!.addEventListener('abort', () => rejeter(Object.assign(new Error('arrêté'), { name: 'AbortError' })))) },
		});
		const { fin } = await e.apprendre({ origine: 'manuel' });
		await expect(e.revenir()).rejects.toMatchObject({ genre: 'occupe' });
		e.arreter();
		await fin;
		expect(etat.coefficients).toEqual([]);
		expect(etat.rapports).toEqual([]);
		expect(etat.historique).toEqual([]);
		expect((await e.etat()).derniereErreur).toBeUndefined();
	});

	it("revenir : échange le modèle et le modèle d'avant ; sans modèle d'avant, refusé", async () => {
		const sans = faux([]);
		await expect(sans.e.revenir()).rejects.toMatchObject({ genre: 'refuse', message: "Aucun modèle d'avant." });
		const { e, etat } = faux([], { avant: true });
		await e.revenir();
		expect(etat.retours).toBe(1);
		expect(etat.changements).toBeGreaterThan(0);
	});
});
