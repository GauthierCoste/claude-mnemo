import { describe, expect, it, vi } from 'vitest';
import type { CasContexte } from '../../src/application/banc-contexte.ts';
import { ErreurEntrainement } from '../../src/application/entrainement.ts';
import type { Entrainement, ImplicitesDApprentissage, LigneHistorique } from '../../src/application/entrainement.ts';
import type { RapportDApprentissage } from '../../src/application/apprendre-note.ts';
import {
	attenteImmediate,
	CALME_APRES_CALCUL_MS,
	classementsServis,
	decider,
	DELAI_ENTRE_APPRENTISSAGES_MS,
	dernierApprentissage,
	GESTES_NOUVEAUX_MIN,
	reapprendreSiPret,
	remplacerAutomatiquement,
} from '../../src/application/reapprentissage.ts';
import type { EtatPourReapprendre, PortsReapprentissage } from '../../src/application/reapprentissage.ts';
import type { Classe, EntreeServie, GesteNote } from '../../src/application/ports.ts';
import type { Geste } from '../../src/domaine/gestes.ts';
import { modeleNonAppris } from '../../src/domaine/modele-de-note.ts';
import type { ModeleDeNote } from '../../src/domaine/modele-de-note.ts';
import type { EtatDuModele, ModelesDeNote } from '../../src/domaine/note-de-confiance.ts';

const HEURE = 60 * 60_000;
const MAINTENANT = Date.parse('2026-11-26T10:00:00.000Z');

const appris = (extra: Partial<ModeleDeNote> = {}): ModeleDeNote => ({ ...modeleNonAppris(), apprisLe: '2026-11-20T10:00:00.000Z', poids: { cosinusRelatif: 1 }, refus: [], ...extra });
const modeles = (complets: EtatDuModele, sens: EtatDuModele, extra: Partial<ModeleDeNote> = {}): ModelesDeNote => {
	const m = (etat: EtatDuModele) => ({ modele: etat === 'non_appris' ? modeleNonAppris() : appris({ accepte: etat === 'accepte' || etat === 'coupe', ...(etat === 'depart' ? { origine: 'depart' as const } : {}), ...extra }), etat });
	return { complets: m(complets), sens: m(sens) };
};

const pret: EtatPourReapprendre = {
	actif: true,
	tacheEnCours: false,
	calculs: { enCours: 0, dernierMs: MAINTENANT - 10 * 60_000 },
	dernierApprentissageMs: MAINTENANT - 25 * HEURE,
	maintenantMs: MAINTENANT,
	pairesValidees: 40,
	gestesNouveaux: GESTES_NOUVEAUX_MIN,
};

describe('réapprentissage en fond : la décision', () => {
	it('toutes les conditions réunies : lancer', () => {
		expect(decider(pret)).toEqual({ lancer: true });
		expect(decider({ ...pret, dernierApprentissageMs: null })).toEqual({ lancer: true });
	});

	it.each<[string, Partial<EtatPourReapprendre>, string]>([
		['réglage coupé', { actif: false }, 'réglage coupé'],
		['tâche en cours', { tacheEnCours: true }, 'une tâche de l’entraînement est en cours'],
		['hook en calcul', { calculs: { enCours: 1, dernierMs: MAINTENANT - HEURE } }, 'une session calcule'],
		['calcul fini il y a moins d’une minute', { calculs: { enCours: 0, dernierMs: MAINTENANT - CALME_APRES_CALCUL_MS + 1 } }, 'une session vient de calculer'],
		['dernier apprentissage il y a moins de 24 h', { dernierApprentissageMs: MAINTENANT - DELAI_ENTRE_APPRENTISSAGES_MS + 1 }, 'dernier apprentissage il y a moins de 24 h'],
		['aucun jugement validé', { pairesValidees: 0 }, 'aucun jugement validé au banc'],
		['trop peu de gestes nouveaux', { gestesNouveaux: GESTES_NOUVEAUX_MIN - 1 }, '19 geste(s) nouveau(x), il en faut 20'],
	])('%s : attendre', (_, changement, motif) => {
		expect(decider({ ...pret, ...changement })).toEqual({ lancer: false, motif });
	});

	it('aux bornes : 24 h pile et une minute pile de calme suffisent ; aucun calcul jamais vu non plus', () => {
		expect(decider({ ...pret, dernierApprentissageMs: MAINTENANT - DELAI_ENTRE_APPRENTISSAGES_MS, calculs: { enCours: 0, dernierMs: MAINTENANT - CALME_APRES_CALCUL_MS } })).toEqual({ lancer: true });
		expect(attenteImmediate({ ...pret, calculs: { enCours: 0, dernierMs: -Infinity } })).toBeNull();
	});
});

describe('réapprentissage en fond : le dernier apprentissage', () => {
	const ligne = (date: string): LigneHistorique => ({ date, origine: 'automatique', verdicts: { complets: 'refuse', sens: 'refuse' }, remplace: false });

	it('la ligne d’historique la plus récente (réussie ou en échec), ou la date d’un modèle appris sur la mémoire', () => {
		expect(dernierApprentissage([ligne('2026-11-21T10:00:00.000Z'), { ...ligne('2026-11-25T10:00:00.000Z'), erreur: 'panne' }], modeles('non_appris', 'non_appris'))).toBe(Date.parse('2026-11-25T10:00:00.000Z'));
		// appris au terminal, sans ligne d'historique
		expect(dernierApprentissage([], modeles('refuse', 'accepte'))).toBe(Date.parse('2026-11-20T10:00:00.000Z'));
	});

	it('un modèle de départ ou jamais appris ne compte pas ; une date illisible non plus', () => {
		expect(dernierApprentissage([], modeles('depart', 'depart'))).toBeNull();
		expect(dernierApprentissage([ligne('hier')], modeles('non_appris', 'non_appris'))).toBeNull();
	});
});

describe('réapprentissage en fond : les classements servis', () => {
	const classe = (id: string, rang: number): Classe => ({ id, rang, note: 0.5, servi: false, signaux: { cosinus: 0.8, cosinusRelatif: 0.1, bm25Relatif: null, signalSession: 0 } as Classe['signaux'] });
	const entree = (session: string, rangMessage: number | undefined, horodatageMs: number, lignes: Classe[], moment: EntreeServie['moment'] = 'message'): EntreeServie =>
		({ session, moment, horodatageMs, ids: [], texte: '', ms: 1, sens: true, demande: 'q', classement: lignes, muet: null, cartes: [], position: null, ...(rangMessage === undefined ? {} : { rangMessage }) }) as EntreeServie;

	it('messages porteurs seulement, une entrée par (session, message), la plus récente ; sans classement ou sans rang : laissée', () => {
		const c = classementsServis([
			entree('S1', 1, 10, [classe('a.md', 1)]),
			entree('S1', 1, 20, [classe('b.md', 1)]),
			entree('S1', 2, 30, []),
			entree('S1', undefined, 40, [classe('c.md', 1)]),
			entree('S1', 3, 50, [classe('d.md', 1)], 'apres_outil'),
			entree('S2', 1, 5, [classe('e.md', 1)]),
		]);
		expect(c.map((x) => [x.session, x.rangMessage, x.lignes.map((l) => l.id)])).toEqual([
			['S1', 1, ['b.md']],
			['S2', 1, ['e.md']],
		]);
	});
});

describe('réapprentissage en fond : la règle de remplacement (D8)', () => {
	const nouveau = (complets: boolean, sens: boolean) => ({ coefficients: { complets: appris({ accepte: complets }), sens: appris({ accepte: sens }) } }) as Pick<RapportDApprentissage, 'coefficients'>;

	it('nouveau accepté : remplace, même un accepté', () => {
		expect(remplacerAutomatiquement(nouveau(true, true), modeles('accepte', 'accepte'))).toBe(true);
		expect(remplacerAutomatiquement(nouveau(true, true), modeles('refuse', 'non_appris'))).toBe(true);
		expect(remplacerAutomatiquement(nouveau(true, false), modeles('refuse', 'refuse'))).toBe(true);
	});

	it('nouveau refusé : remplace un refusé, un de départ ou un jamais appris', () => {
		expect(remplacerAutomatiquement(nouveau(false, false), modeles('refuse', 'refuse'))).toBe(true);
		expect(remplacerAutomatiquement(nouveau(false, false), modeles('depart', 'depart'))).toBe(true);
		expect(remplacerAutomatiquement(nouveau(false, false), modeles('non_appris', 'non_appris'))).toBe(true);
	});

	it('jamais un accepté (ou coupé par le suivi) par un refusé, à aucun niveau', () => {
		expect(remplacerAutomatiquement(nouveau(false, false), modeles('accepte', 'refuse'))).toBe(false);
		expect(remplacerAutomatiquement(nouveau(false, false), modeles('coupe', 'refuse'))).toBe(false);
		// accepté à un niveau de plus, mais refusé là où l'actuel est accepté : gardé
		expect(remplacerAutomatiquement(nouveau(true, false), modeles('refuse', 'accepte'))).toBe(false);
		// accepté sans poids ni date (niveau sans paire) : ce n'est pas un accepté
		const vide = { coefficients: { complets: { ...modeleNonAppris(), accepte: true }, sens: appris({ accepte: true }) } } as Pick<RapportDApprentissage, 'coefficients'>;
		expect(remplacerAutomatiquement(vide, modeles('accepte', 'accepte'))).toBe(false);
	});
});

describe('réapprentissage en fond : la vérification dans le service (ports factices)', () => {
	const valide: CasContexte = {
		nom: 'v',
		position: 'p',
		message: 'm',
		premier: false,
		attendues: [],
		interdites: [],
		silence: false,
		session: 's',
		rang: 1,
		candidates: [{ chemin: 'a.md', titre: 'A', ligne: 'a', listes: ['sens'], signaux: {} }],
		jugements: { 'a.md': 'non_pertinente' },
	};
	const geste = (g: Geste, session: string, fiche: string, horodatageMs: number, rang: number): GesteNote => ({
		rang,
		horodatageMs,
		geste: g,
		origine: 'utilisateur',
		session,
		dossier: '',
		position: null,
		fiche,
		empreinte: null,
		message: null,
		rangMessage: 1,
		note: { rang: 1, signaux: { cosinusRelatif: 0.2, bm25Relatif: null } },
		vecteur: null,
		modeleVecteur: null,
	});

	function faux(o: { actif?: boolean; tache?: boolean; calculs?: { enCours: number; dernierMs: number }; historique?: LigneHistorique[]; banc?: CasContexte[]; gestes?: GesteNote[]; apprendre?: Entrainement['apprendre'] } = {}) {
		const gestes = o.gestes ?? Array.from({ length: GESTES_NOUVEAUX_MIN }, (_, i) => geste('ecartee_ici', `S${i % 3}`, `f${i}.md`, MAINTENANT - HEURE + i, i + 1));
		const appels: { origine: string; implicites?: ImplicitesDApprentissage; remplacer?: unknown }[] = [];
		const lectures = { gestes: [] as unknown[], servis: [] as string[], historique: 0 };
		const ports: PortsReapprentissage = {
			actif: () => o.actif ?? true,
			entrainement: {
				tache: () => (o.tache === true ? { genre: 'prejuger', fait: 0, total: 1, depuis: '' } : null),
				apprendre:
					o.apprendre ??
					(async (a) => {
						appels.push(a);
						return { fin: Promise.resolve() };
					}),
			},
			calculs: () => o.calculs ?? { enCours: 0, dernierMs: -Infinity },
			historique: async () => {
				lectures.historique++;
				return o.historique ?? [];
			},
			modeles: async () => modeles('depart', 'depart'),
			banc: async () => o.banc ?? [valide],
			gestes: async (f) => {
				lectures.gestes.push(f);
				return gestes.filter((g) => (f.depuisMs === undefined || g.horodatageMs >= f.depuisMs) && (f.sortes === undefined || f.sortes.includes(g.geste)));
			},
			servis: async (session) => {
				lectures.servis.push(session);
				return [
					{
						session,
						moment: 'message',
						horodatageMs: 1,
						ids: [],
						texte: '',
						ms: 1,
						sens: true,
						demande: 'q',
						muet: null,
						cartes: [],
						position: null,
						rangMessage: 1,
						classement: [{ id: `${session}-x.md`, rang: 1, note: 0.4, servi: false, signaux: { cosinus: 0.5, cosinusRelatif: 0.3, bm25Relatif: null, signalSession: 0 } as Classe['signaux'] }],
					},
				];
			},
			sensInstalle: () => 'bge.gguf@abc',
			maintenantMs: () => MAINTENANT,
		};
		return { ports, appels, lectures };
	}

	it('prêt : lance un apprentissage automatique avec la règle D8 ; les paires implicites, calculées par la tâche, viennent du journal et des classements des sessions jugées', async () => {
		const { ports, appels, lectures } = faux();
		const r = await reapprendreSiPret(ports);
		expect(r.lance).toBe(true);
		expect(appels).toHaveLength(1);
		expect(appels[0]!.origine).toBe('automatique');
		expect(appels[0]!.remplacer).toBe(remplacerAutomatiquement);
		// rien n'est lu des sessions avant la tâche
		expect(lectures.servis).toEqual([]);
		const implicites = await (appels[0]!.implicites as (s: AbortSignal) => Promise<readonly { y: boolean }[]>)(new AbortController().signal);
		expect(new Set(lectures.servis)).toEqual(new Set(['S0', 'S1', 'S2']));
		// 20 ✗ et une fiche sans geste au rang 1 de chaque session
		expect(implicites.filter((p) => p.y === false)).toHaveLength(GESTES_NOUVEAUX_MIN + 3);
	});

	it('gestes nouveaux comptés depuis le dernier apprentissage, parmi ceux qui jugent une fiche', async () => {
		const depuis = MAINTENANT - 25 * HEURE;
		const anciens = Array.from({ length: 30 }, (_, i) => geste('injectee_main', 'S', `a${i}.md`, depuis - 1000, i));
		const recents = Array.from({ length: 25 }, (_, i) => geste(i < 10 ? 'retablie' : 'lue_apres_carte', 'S', `r${i}.md`, depuis + 1000, 100 + i));
		const ligne: LigneHistorique = { date: new Date(depuis).toISOString(), origine: 'manuel', verdicts: { complets: 'refuse', sens: 'refuse' }, remplace: true };
		const { ports, appels } = faux({ gestes: [...anciens, ...recents], historique: [ligne] });
		// 15 lectures après carte seulement (les rétablissements ne jugent pas)
		expect(await reapprendreSiPret(ports)).toEqual({ lance: false, motif: '15 geste(s) nouveau(x), il en faut 20' });
		expect(appels).toEqual([]);
	});

	it.each<[string, Parameters<typeof faux>[0], string]>([
		['réglage coupé', { actif: false }, 'réglage coupé'],
		['une tâche en cours', { tache: true }, 'une tâche de l’entraînement est en cours'],
		['un hook en calcul', { calculs: { enCours: 1, dernierMs: MAINTENANT } }, 'une session calcule'],
		['appris il y a une heure', { historique: [{ date: new Date(MAINTENANT - HEURE).toISOString(), origine: 'automatique', verdicts: { complets: 'refuse', sens: 'refuse' }, remplace: false }] }, 'dernier apprentissage il y a moins de 24 h'],
		['banc sans jugement validé', { banc: [{ ...valide, jugements: {} }] }, 'aucun jugement validé au banc'],
	])('ne lance pas : %s', async (_, o, motif) => {
		const { ports, appels } = faux(o);
		expect(await reapprendreSiPret(ports)).toEqual({ lance: false, motif });
		expect(appels).toEqual([]);
	});

	it('réglage coupé : rien n’est lu', async () => {
		const { ports, lectures } = faux({ actif: false });
		await reapprendreSiPret(ports);
		expect(lectures).toEqual({ gestes: [], servis: [], historique: 0 });
	});

	it('jamais de rejet : verrou du banc tenu ailleurs (attente), panne d’une lecture (erreur)', async () => {
		const occupe = faux({ apprendre: async () => Promise.reject(new ErreurEntrainement('occupe', 'Le fichier des jugements est ouvert par « mnemo banc contexte --juger »')) });
		expect(await reapprendreSiPret(occupe.ports)).toEqual({ lance: false, motif: 'Le fichier des jugements est ouvert par « mnemo banc contexte --juger »' });
		const panne = faux();
		panne.ports.banc = vi.fn(async () => Promise.reject(new Error('fichier des jugements illisible')));
		expect(await reapprendreSiPret(panne.ports)).toEqual({ lance: false, motif: 'fichier des jugements illisible', erreur: true });
	});

	it('paires implicites arrêtées : la lecture des sessions s’interrompt', async () => {
		const { ports, appels, lectures } = faux();
		await reapprendreSiPret(ports);
		const controle = new AbortController();
		controle.abort();
		await expect((appels[0]!.implicites as (s: AbortSignal) => Promise<unknown>)(controle.signal)).rejects.toMatchObject({ name: 'AbortError' });
		expect(lectures.servis).toEqual([]);
	});
});
