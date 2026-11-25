/**
 * Suivi des injections automatiques (spec classement vivant § 6.4) : les coupures se déduisent du journal des gestes
 * (`domaine/suivi-injection.ts`), et la réactivation par l'utilisateur est un geste noté (`injection_reactivee`).
 *
 * Lecture bornée : par niveau, la dernière réactivation, puis les `FENETRE_SUIVI` dernières injections automatiques depuis la
 * référence (apprentissage ou réactivation), puis seulement les gestes d'après la plus ancienne d'entre elles. Le service garde
 * l'état en mémoire (`suiviDesInjections`) et le relit en fond, après les gestes et quand les modèles changent ; le hook ne le
 * relit pas. Sans service (ou avant la première lecture), le hook fait cette lecture bornée.
 */
import { AUCUNE_COUPURE, avecLesCoupures, coupureDuNiveau, FENETRE_SUIVI, instantDApprentissage } from '../domaine/suivi-injection.ts';
import type { CoupuresDInjection, GesteDuSuivi } from '../domaine/suivi-injection.ts';
import type { ModelesDeNote } from '../domaine/note-de-confiance.ts';
import type { NiveauDeNote } from '../domaine/modele-de-note.ts';
import { noterGeste } from './gestes.ts';
import type { Dependances, EtatSessions, GesteNote } from './ports.ts';

const NIVEAUX: readonly NiveauDeNote[] = ['complets', 'sens'];

const niveauDe = (g: GesteNote): NiveauDeNote | null => {
	const n = g.note?.['niveau'];
	return n === 'complets' || n === 'sens' ? n : null;
};
const versSuivi = (g: GesteNote): GesteDuSuivi => ({ rang: g.rang, horodatageMs: g.horodatageMs, geste: g.geste, session: g.session, fiche: g.fiche, niveau: niveauDe(g) });

/** Motif d'une coupure faute d'avoir pu lire le suivi. */
export const MOTIF_SUIVI_ILLISIBLE = 'suivi des injections illisible : injection automatique suspendue jusqu’à la prochaine lecture';

/** Tous les niveaux acceptés coupés : ce que vaut un suivi jamais lu dont la lecture échoue. */
export function toutesCoupees(modeles: ModelesDeNote, maintenantMs = Date.now()): CoupuresDInjection {
	const coupe = (niveau: NiveauDeNote) => (modeles[niveau].etat === 'accepte' ? { niveau, injections: 0, ecartees: 0, depuisMs: maintenantMs, motif: MOTIF_SUIVI_ILLISIBLE } : null);
	return { complets: coupe('complets'), sens: coupe('sens') };
}

/**
 * Les coupures des niveaux dont le modèle est accepté, par une lecture bornée du journal des gestes (sans les vecteurs) ; aucune
 * lecture si aucun modèle n'est accepté. Les réactivations sont toutes lues (rares), avec ou sans niveau ; puis, par niveau,
 * ses `FENETRE_SUIVI` dernières injections depuis sa référence, et les gestes d'après la plus ancienne d'entre elles. Lève si
 * le journal est illisible.
 */
export async function lireCoupures(etat: Pick<EtatSessions, 'gestes'>, modeles: ModelesDeNote): Promise<CoupuresDInjection> {
	const acceptes = NIVEAUX.filter((n) => modeles[n].etat === 'accepte');
	if (acceptes.length === 0) return AUCUNE_COUPURE;
	const reactivations = (await etat.gestes({ sortes: ['injection_reactivee'], sansVecteur: true, limite: null })).map(versSuivi);
	const coupures: CoupuresDInjection = { ...AUCUNE_COUPURE };
	for (const niveau of acceptes) {
		const apprentissage = instantDApprentissage(modeles[niveau].modele.apprisLe);
		let reference = apprentissage ?? -Infinity;
		for (const r of reactivations) if ((r.niveau === null || r.niveau === niveau) && r.horodatageMs > reference) reference = r.horodatageMs;
		const injections = await etat.gestes({ sortes: ['injectee_auto'], niveau, sansVecteur: true, limite: FENETRE_SUIVI, ...(Number.isFinite(reference) ? { depuisMs: reference } : {}) });
		// aucune injection automatique depuis la référence : rien à couper
		if (injections.length === 0) continue;
		const borne = Math.min(...injections.map((g) => g.horodatageMs));
		const lus = await etat.gestes({ sortes: ['injectee_auto', 'ecartee_ici', 'ecartee_toujours', 'retablie'], depuisMs: borne, sansVecteur: true, limite: null });
		coupures[niveau] = coupureDuNiveau([...reactivations, ...lus.map(versSuivi)], niveau, apprentissage);
	}
	return coupures;
}

/**
 * Les coupures, lues une fois (hook sans service, vue `GET`, réactivation) : journal illisible, tous les niveaux acceptés sont
 * coupés (rien ne dit que le filet tient), jusqu'à une lecture réussie.
 */
export async function coupuresDesInjections(etat: Pick<EtatSessions, 'gestes'>, modeles: ModelesDeNote): Promise<CoupuresDInjection> {
	try {
		return await lireCoupures(etat, modeles);
	} catch {
		return toutesCoupees(modeles);
	}
}

/** Identité de ce que le suivi a lu : l'état et l'apprentissage du modèle de chaque niveau. */
const signature = (m: ModelesDeNote): string => JSON.stringify(NIVEAUX.map((n) => [m[n].etat, m[n].modele.apprisLe]));

/**
 * Le suivi tenu par le service. `coupures(modeles)` : l'état gardé s'il a été lu pour ces modèles (même état, même
 * apprentissage) ; null sinon (pas encore lu, ou nouvel apprentissage), une relecture est alors lancée. `actualiser` relit
 * (une relecture à la fois, plus une seule en attente pour toutes les demandes qui arrivent entre-temps) et rend vrai si les
 * coupures ont changé. Une lecture qui échoue garde les coupures précédentes (la toute première : tous les niveaux acceptés
 * coupés), rendues par `coupures` jusqu'à une lecture réussie. `perime` : les modèles ont changé depuis la dernière lecture. `derniere` : les dernières lues (vue des
 * sessions). `quandChange` : appelé après la première lecture et après chaque lecture qui change les coupures (rediffusion).
 */
export type SuiviDesInjections = {
	coupures(modeles: ModelesDeNote): CoupuresDInjection | null;
	actualiser(): Promise<boolean>;
	perime(modeles: ModelesDeNote): boolean;
	derniere(): CoupuresDInjection;
};

export function suiviDesInjections(
	etat: Pick<EtatSessions, 'gestes'>,
	modeles: () => ModelesDeNote,
	quandChange: (coupures: CoupuresDInjection) => Promise<void> | void = () => {},
): SuiviDesInjections {
	// `echec` : la dernière lecture a échoué ; les coupures gardées sont alors les précédentes (toutes coupées s'il n'y en a pas)
	let lu: { signature: string; coupures: CoupuresDInjection; echec: boolean } | null = null;
	let enCours: Promise<boolean> | null = null;
	let suivante: Promise<boolean> | null = null;

	const lire = async (): Promise<boolean> => {
		const m = modeles();
		let coupures: CoupuresDInjection;
		let echec = false;
		try {
			coupures = await lireCoupures(etat, m);
		} catch {
			echec = true;
			coupures = lu?.coupures ?? toutesCoupees(m);
		}
		const premiere = lu === null;
		const change = JSON.stringify(coupures) !== JSON.stringify(lu?.coupures ?? AUCUNE_COUPURE);
		lu = { signature: signature(m), coupures, echec };
		if (premiere || change) await Promise.resolve(quandChange(coupures)).catch(() => {});
		return change;
	};
	const lancer = (): Promise<boolean> => {
		const p = lire().finally(() => {
			if (enCours === p) enCours = null;
		});
		enCours = p;
		return p;
	};
	const actualiser = (): Promise<boolean> => {
		if (enCours === null) return lancer();
		suivante ??= enCours
			.catch(() => false)
			.then(() => {
				suivante = null;
				return lancer();
			});
		return suivante;
	};
	const perime = (m: ModelesDeNote): boolean => lu === null || lu.echec || lu.signature !== signature(m);
	return {
		coupures(m) {
			if (!perime(m)) return lu!.coupures;
			void actualiser().catch(() => false);
			// lecture en échec : les coupures gardées valent jusqu'à une lecture réussie
			return lu?.echec === true ? lu.coupures : null;
		},
		actualiser,
		perime,
		derniere: () => lu?.coupures ?? AUCUNE_COUPURE,
	};
}

/**
 * Les modèles du message avec les coupures appliquées : celles du suivi du service s'il les a lues pour ces modèles, sinon une
 * lecture bornée du journal.
 */
export async function modelesSuivis(etat: Pick<EtatSessions, 'gestes'>, modeles: ModelesDeNote, suivi?: Pick<SuiviDesInjections, 'coupures'>): Promise<ModelesDeNote> {
	return avecLesCoupures(modeles, suivi?.coupures(modeles) ?? (await coupuresDesInjections(etat, modeles)));
}

/** Le suivi n'a pas pu être lu : l'état de coupure des niveaux est inconnu, rien n'est réactivé. */
export class SuiviIllisible extends Error {
	constructor() {
		super('Suivi des injections illisible : réessaie.');
		this.name = 'SuiviIllisible';
	}
}

/**
 * Réactive l'injection automatique des niveaux coupés (`niveau` : celui-là seulement) : un geste `injection_reactivee` par
 * niveau, noté dans `session` (vide : hors session). Rend les niveaux réactivés (aucun : rien n'était coupé). Journal des
 * gestes illisible : lève `SuiviIllisible`, sans rien noter (aucun geste pour un niveau dont la coupure est inconnue).
 */
export async function reactiverInjection(
	dep: Pick<Dependances, 'index'>,
	etat: Pick<EtatSessions, 'gestes' | 'noterGeste'>,
	modeles: ModelesDeNote,
	o: { session: string; horodatageMs: number; niveau?: NiveauDeNote },
): Promise<NiveauDeNote[]> {
	let coupures: CoupuresDInjection;
	try {
		coupures = await lireCoupures(etat, modeles);
	} catch {
		throw new SuiviIllisible();
	}
	const reactives = NIVEAUX.filter((n) => coupures[n] !== null && (o.niveau === undefined || o.niveau === n));
	for (const niveau of reactives) {
		await noterGeste(dep, etat, { geste: 'injection_reactivee', session: o.session, fiche: '', empreinte: null, horodatageMs: o.horodatageMs, note: { niveau, motif: coupures[niveau]!.motif } });
	}
	return reactives;
}
