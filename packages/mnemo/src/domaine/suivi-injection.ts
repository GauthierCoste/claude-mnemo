// Suivi réel des injections automatiques et coupure (spec classement vivant § 6.4, décisions du 25/11). Pur : tout est déduit
// du journal des gestes à la lecture, sans autre stockage.
//
// - Par niveau de modèle, les injections automatiques (`injectee_auto`, le niveau dans leur note) faites depuis la référence du
//   niveau : la date d'apprentissage du modèle en service, ou la dernière réactivation par l'utilisateur si elle est plus
//   récente. Un nouvel apprentissage accepté, plus récent que la coupure, repart donc d'une fenêtre vide.
// - Une injection est fausse si la fiche est écartée (ici ou toujours) dans la même session après elle, avant une nouvelle
//   injection automatique de la même fiche, et que l'écart n'a pas été annulé (`retablie`) ensuite ; juste sinon
//   (approximation optimiste, dite comme telle).
// - Fenêtre glissante : les `FENETRE_SUIVI` dernières. Coupure si la borne basse de Wilson (95 %) de la fenêtre passe sous
//   `WILSON_COUPURE`. Une fenêtre encore incomplète est comptée comme si les injections qui manquent étaient justes : elle ne
//   coupe que si même une fenêtre pleine de justes ne remonterait pas au-dessus (assez de fausses déjà) ; sans cela, une
//   poignée d'injections parfaites couperait (Wilson de 10 sur 10 : 0,72).

import type { Geste } from './gestes.ts';
import { intervalleWilson } from './mesures-banc.ts';
import type { ModelesDeNote } from './note-de-confiance.ts';
import type { NiveauDeNote } from './modele-de-note.ts';

export const FENETRE_SUIVI = 100;
export const WILSON_COUPURE = 0.75;

/** Les gestes que le suivi lit. */
export const GESTES_DU_SUIVI: readonly Geste[] = ['injectee_auto', 'ecartee_ici', 'ecartee_toujours', 'retablie', 'injection_reactivee'];

/** Un geste lu par le suivi : `niveau` (dans sa note) pour `injectee_auto` et `injection_reactivee` (null : tous les niveaux). */
export type GesteDuSuivi = { rang: number; horodatageMs: number; geste: Geste; session: string; fiche: string; niveau: NiveauDeNote | null };

/**
 * Un niveau coupé : `injections` de la fenêtre, dont `ecartees` ; `depuisMs` : l'écart le plus récent compté ; `motif` : ce
 * que le panneau dit.
 */
export type CoupureDInjection = { niveau: NiveauDeNote; injections: number; ecartees: number; depuisMs: number; motif: string };
export type CoupuresDInjection = Record<NiveauDeNote, CoupureDInjection | null>;

export const AUCUNE_COUPURE: CoupuresDInjection = { complets: null, sens: null };

const chronologique = (a: GesteDuSuivi, b: GesteDuSuivi) => a.horodatageMs - b.horodatageMs || a.rang - b.rang;
const ECARTS: readonly Geste[] = ['ecartee_ici', 'ecartee_toujours'];

/** Le motif dit d'une coupure. */
export const motifDeCoupure = (ecartees: number, injections: number): string =>
	`${ecartees} des ${injections} dernières fiches injectées par Mnemo ont été écartées`;

/** L'écart qui rend une injection automatique fausse (null : juste), par rang de l'injection. */
type IssueDesInjections = Map<number, GesteDuSuivi | null>;

/**
 * L'issue de chaque injection automatique, en un seul passage chronologique (linéaire après le tri) : par (session, fiche),
 * l'injection en cours reçoit le premier écart qui la suit ; un rétablissement l'annule ; l'injection automatique suivante de
 * la même fiche dans la session la clôt.
 */
function issuesDesInjections(gestes: readonly GesteDuSuivi[]): IssueDesInjections {
	const issues: IssueDesInjections = new Map();
	const enCours = new Map<string, number>();
	for (const g of [...gestes].sort(chronologique)) {
		const cle = `${g.session}\u0000${g.fiche}`;
		if (g.geste === 'injectee_auto') {
			issues.set(g.rang, null);
			enCours.set(cle, g.rang);
			continue;
		}
		const rang = enCours.get(cle);
		if (rang === undefined) continue;
		if (ECARTS.includes(g.geste)) {
			if (issues.get(rang) === null) issues.set(rang, g);
		} else if (g.geste === 'retablie') issues.set(rang, null);
	}
	return issues;
}

/** La référence d'un niveau : son apprentissage, ou sa dernière réactivation par l'utilisateur si elle est plus récente. */
function referenceDuNiveau(gestes: readonly GesteDuSuivi[], niveau: NiveauDeNote, apprentissage: number | null): number {
	let depuis = apprentissage ?? -Infinity;
	for (const g of gestes) if (g.geste === 'injection_reactivee' && (g.niveau === null || g.niveau === niveau) && g.horodatageMs > depuis) depuis = g.horodatageMs;
	return depuis;
}

function coupureAvecIssues(gestes: readonly GesteDuSuivi[], issues: IssueDesInjections, niveau: NiveauDeNote, reference: number | null): CoupureDInjection | null {
	const depuis = referenceDuNiveau(gestes, niveau, reference);
	const fenetre = gestes.filter((g) => g.geste === 'injectee_auto' && g.niveau === niveau && g.horodatageMs > depuis).sort(chronologique).slice(-FENETRE_SUIVI);
	if (fenetre.length === 0) return null;
	let ecartees = 0;
	let depuisMs = -Infinity;
	for (const inj of fenetre) {
		const ecart = issues.get(inj.rang) ?? null;
		if (ecart === null) continue;
		ecartees += 1;
		depuisMs = Math.max(depuisMs, ecart.horodatageMs);
	}
	// les injections qui manquent à une fenêtre incomplète comptent justes
	if (intervalleWilson(FENETRE_SUIVI - ecartees, FENETRE_SUIVI).basse >= WILSON_COUPURE) return null;
	return { niveau, injections: fenetre.length, ecartees, depuisMs, motif: motifDeCoupure(ecartees, fenetre.length) };
}

/**
 * La coupure d'un niveau, ou null. `reference` : l'instant d'apprentissage du modèle en service (null : inconnu, tout compte).
 * Linéaire en nombre de gestes (après un tri).
 */
export function coupureDuNiveau(gestes: readonly GesteDuSuivi[], niveau: NiveauDeNote, reference: number | null): CoupureDInjection | null {
	return coupureAvecIssues(gestes, issuesDesInjections(gestes), niveau, reference);
}

/** Instant d'un `apprisLe` (date ou instant ISO) ; null s'il est illisible. */
export function instantDApprentissage(apprisLe: string | null): number | null {
	if (apprisLe === null) return null;
	const ms = Date.parse(apprisLe);
	return Number.isFinite(ms) ? ms : null;
}

/** Les coupures des niveaux dont le modèle est accepté (les autres n'injectent pas : rien à suivre). */
export function coupuresDesNiveaux(gestes: readonly GesteDuSuivi[], modeles: ModelesDeNote): CoupuresDInjection {
	const issues = issuesDesInjections(gestes);
	const niveau = (n: NiveauDeNote) => (modeles[n].etat === 'accepte' ? coupureAvecIssues(gestes, issues, n, instantDApprentissage(modeles[n].modele.apprisLe)) : null);
	return { complets: niveau('complets'), sens: niveau('sens') };
}

/** Un niveau coupé n'injecte plus : son modèle passe à l'état `coupe` ; ses % et son ordre calibré restent (➤ pour injecter à la main). */
export function avecLesCoupures(modeles: ModelesDeNote, coupures: CoupuresDInjection): ModelesDeNote {
	const etat = (n: NiveauDeNote) => (coupures[n] !== null && modeles[n].etat === 'accepte' ? { ...modeles[n], etat: 'coupe' as const } : modeles[n]);
	return { complets: etat('complets'), sens: etat('sens') };
}
