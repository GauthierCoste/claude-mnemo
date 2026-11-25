// A priori d'une fiche tiré des gestes des sessions passées (journal durable des gestes) : pur, sans entrée-sortie.
import type { Geste } from './gestes.ts';
import { cosinus } from './sens.ts';

/** Demi-vie d'un geste : son poids est divisé par deux tous les 60 jours. */
export const DEMI_VIE_GESTE_JOURS = 60;
/** Poids d'un geste fait ailleurs (autre position, autre dossier) ; 1 au même lieu. */
export const POIDS_LIEU_AILLEURS = 0.5;
/** Ressemblance du message d'un geste au message courant : bornes, et valeur sans vecteur comparable (celle de la médiane). */
export const RESSEMBLANCE_MIN = 0.5;
export const RESSEMBLANCE_MAX = 1;
export const RESSEMBLANCE_INCONNUE = 0.75;
/**
 * Écart de cosinus à la référence qui mène la ressemblance d'une borne à l'autre : bge-m3 tasse les cosinus dans [0,6 ; 1],
 * seul l'écart à la référence (médiane des messages des gestes) sépare quelque chose.
 */
export const ECHELLE_COSINUS_RELATIF = 0.15;
/**
 * Référence du cosinus relatif : la médiane des messages des gestes, tirée vers `COSINUS_DE_REFERENCE` avec le poids de
 * `MESSAGES_DE_REFERENCE` messages (`(n·médiane + k·C) / (n + k)`) ; `C` seule sous `MESSAGES_POUR_MEDIANE` messages.
 */
export const COSINUS_DE_REFERENCE = 0.65;
export const MESSAGES_DE_REFERENCE = 10;
export const MESSAGES_POUR_MEDIANE = 5;
/** `lue_apres_carte` : positif, mais c'est Claude qui lit, pas l'utilisateur qui demande. */
export const POIDS_LUE_APRES_CARTE = 0.5;
/**
 * Part des lectures de Claude dans les positifs d'une fiche : Σ g ≤ 1. Claude lit ce que Mnemo lui propose ; sans plafond,
 * ses lectures feraient monter l'a priori de ce qui est proposé, qui serait proposé davantage (boucle).
 */
export const PLAFOND_LUE_APRES_CARTE = 1;
/** Lissage bêta : pseudo-comptes positif et négatif. */
export const ALPHA_0 = 2;
export const BETA_0 = 2;
/** L'a priori est borné à ±1 logit. */
export const APRIORI_MAX = 1;
/** Règle de la suggestion « écartée toujours » : sessions distinctes et jours distincts au moins. */
export const SESSIONS_POUR_SUGGESTION = 3;
export const JOURS_POUR_SUGGESTION = 2;

export const JOUR_MS = 86_400_000;

/** Vecteur d'un message et l'identité du modèle qui l'a calculé. */
export type VecteurDApriori = { modele: string; valeurs: Float32Array };

/** Ce qu'il faut d'un geste du journal pour l'a priori (un `GesteNote` convient). */
export type GesteDApriori = {
	geste: Geste;
	session: string;
	/** Rang du message porteur dans la session (0 : aucun) : avec la session, il identifie le message. */
	rangMessage: number;
	horodatageMs: number;
	dossier: string;
	position: string | null;
	fiche: string;
	vecteur: VecteurDApriori | null;
};

export type Sens = 'positif' | 'negatif';

/** Une voix possible d'une session sur une fiche : le geste qui la porte et son poids propre (avant âge, lieu, ressemblance). */
export type Voix = {
	session: string;
	rangMessage: number;
	sens: Sens;
	/** Une lecture de Claude (`lue_apres_carte`) : sa part des positifs est plafonnée. */
	lue: boolean;
	poids: number;
	horodatageMs: number;
	dossier: string;
	position: string | null;
	vecteur: VecteurDApriori | null;
};

/** Le message courant et son lieu ; `sessionCourante` : ses gestes passent par le signal de session, pas par l'a priori. */
export type ContexteApriori = {
	maintenantMs: number;
	sessionCourante: string | null;
	dossier: string | null;
	position: string | null;
	vecteur: VecteurDApriori | null;
};

const chronologique = <T extends { horodatageMs: number }>(gestes: readonly T[]): T[] => [...gestes].sort((a, b) => a.horodatageMs - b.horodatageMs);

/**
 * Les voix d'une fiche, à partir de ses gestes (toutes sessions) : `injectee_main` positive, `lue_apres_carte` positive au
 * poids réduit, `ecartee_ici` et `ecartee_toujours` négatives (aussi après une `injectee_auto`) ; `injectee_auto` seule ne
 * compte jamais ; `retablie` annule les écarts qui la précèdent dans sa session.
 */
export function voixDesGestes(gestes: readonly GesteDApriori[]): Voix[] {
	const parSession = new Map<string, Voix[]>();
	for (const g of chronologique(gestes)) {
		const voix = parSession.get(g.session) ?? [];
		parSession.set(g.session, voix);
		const base = { session: g.session, rangMessage: g.rangMessage, lue: false, horodatageMs: g.horodatageMs, dossier: g.dossier, position: g.position, vecteur: g.vecteur };
		switch (g.geste) {
			case 'injectee_main':
				voix.push({ ...base, sens: 'positif', poids: 1 });
				break;
			case 'lue_apres_carte':
				voix.push({ ...base, sens: 'positif', poids: POIDS_LUE_APRES_CARTE, lue: true });
				break;
			case 'ecartee_ici':
			case 'ecartee_toujours':
				voix.push({ ...base, sens: 'negatif', poids: 1 });
				break;
			case 'retablie':
				parSession.set(g.session, voix.filter((v) => v.sens !== 'negatif'));
				break;
			case 'injectee_auto':
				// jamais positive : Mnemo l'a choisie seul ; un écart qui la suit est négatif comme tout écart
				break;
			case 'injection_reactivee':
				// un réglage, pas un geste sur une fiche
				break;
		}
	}
	return [...parSession.values()].flat();
}

function comparables(a: VecteurDApriori | null, b: VecteurDApriori | null): boolean {
	return a !== null && b !== null && a.modele === b.modele && a.valeurs.length === b.valeurs.length && a.valeurs.length > 0;
}

/**
 * Les cosinus du message courant aux messages des voix, calculés une seule fois par message (session et rang du message ;
 * un même vecteur n'est jamais recalculé) : `cosinusDe(voix)`, null sans vecteur comparable ; `reference` : la référence du
 * cosinus relatif (null sans message comparable).
 */
export function cosinusDesMessages(voix: readonly Voix[], courant: VecteurDApriori | null): { cosinusDe(v: Voix): number | null; reference: number | null } {
	const parVecteur = new Map<Float32Array, number>();
	const parMessage = new Map<string, number>();
	const cosinusDe = (v: Voix): number | null => {
		if (courant === null || !comparables(v.vecteur, courant)) return null;
		const deja = parVecteur.get(v.vecteur!.valeurs);
		if (deja !== undefined) return deja;
		const c = cosinus(v.vecteur!.valeurs, courant.valeurs);
		parVecteur.set(v.vecteur!.valeurs, c);
		return c;
	};
	for (const v of voix) {
		const c = cosinusDe(v);
		if (c !== null) parMessage.set(`${v.session}\u0000${v.rangMessage}`, c);
	}
	return { cosinusDe, reference: referenceDesCosinus([...parMessage.values()]) };
}

/** Référence du cosinus relatif, un cosinus par message : `C` sous 5 messages, sinon `(n·médiane + k·C) / (n + k)` ; null sans message. */
export function referenceDesCosinus(cosinus_: readonly number[]): number | null {
	const n = cosinus_.length;
	if (n === 0) return null;
	if (n < MESSAGES_POUR_MEDIANE) return COSINUS_DE_REFERENCE;
	const tries = [...cosinus_].sort((x, y) => x - y);
	const milieu = Math.floor(n / 2);
	const mediane = n % 2 === 1 ? tries[milieu]! : (tries[milieu - 1]! + tries[milieu]!) / 2;
	return (n * mediane + MESSAGES_DE_REFERENCE * COSINUS_DE_REFERENCE) / (n + MESSAGES_DE_REFERENCE);
}

/** `0,5^(âge / 60 j)` ; un geste daté dans le futur pèse comme un geste d'aujourd'hui. */
export function decroissance(ageMs: number): number {
	return 0.5 ** (Math.max(0, ageMs) / JOUR_MS / DEMI_VIE_GESTE_JOURS);
}

/** 1 au même lieu (même position déclarée, ou même dossier), `POIDS_LIEU_AILLEURS` sinon ; une position vide ne compte pas. */
export function lieu(v: Pick<Voix, 'dossier' | 'position'>, c: Pick<ContexteApriori, 'dossier' | 'position'>): number {
	const memePosition = v.position !== null && v.position !== '' && v.position === c.position;
	const memeDossier = c.dossier !== null && v.dossier === c.dossier;
	return memePosition || memeDossier ? 1 : POIDS_LIEU_AILLEURS;
}

/**
 * Cosinus du message du geste au message courant, relatif à la référence (`cos − référence`), ramené dans [0,5 ; 1] : 0,75
 * à la référence, les bornes à ±`ECHELLE_COSINUS_RELATIF`. 0,75 sans cosinus (un vecteur manque, ou leurs modèles diffèrent).
 */
export function ressemblance(cos: number | null, reference: number | null): number {
	if (cos === null || reference === null) return RESSEMBLANCE_INCONNUE;
	const relatif = cos - reference;
	const r = RESSEMBLANCE_INCONNUE + ((RESSEMBLANCE_MAX - RESSEMBLANCE_MIN) / 2) * (relatif / ECHELLE_COSINUS_RELATIF);
	return Math.min(RESSEMBLANCE_MAX, Math.max(RESSEMBLANCE_MIN, r));
}

/** Ce qu'il faut, pour un message, au poids de chaque voix : son contexte, et le cosinus de chaque message à lui. */
export type Comparaison = { contexte: ContexteApriori; cosinusDe(v: Voix): number | null; reference: number | null };

/** Poids `g` d'une voix pour le message courant : poids propre × décroissance × lieu × ressemblance. */
export function poidsDeLaVoix(v: Voix, comparaison: Comparaison): number {
	const c = comparaison.contexte;
	return v.poids * decroissance(c.maintenantMs - v.horodatageMs) * lieu(v, c) * ressemblance(comparaison.cosinusDe(v), comparaison.reference);
}

/**
 * A priori d'une fiche, en logit : une voix par session et par sens (le plus fort `g`, pas la somme), la session courante
 * exclue ; ce que les lectures de Claude ajoutent aux positifs est plafonné à `PLAFOND_LUE_APRES_CARTE` ; `a = α₀ + Σ g⁺`,
 * `b = β₀ + Σ g⁻`, `log(a / b)` borné à ±`APRIORI_MAX`. 0 sans voix.
 */
export function aprioriDesVoix(voix: readonly Voix[], comparaison: Comparaison): number {
	/** Par session : le plus fort positif de l'utilisateur, le plus fort de Claude, le plus fort négatif. */
	const parSession = new Map<string, { main: number; lue: number; negatif: number }>();
	for (const v of voix) {
		if (v.session === comparaison.contexte.sessionCourante) continue;
		const m = parSession.get(v.session) ?? { main: 0, lue: 0, negatif: 0 };
		const g = poidsDeLaVoix(v, comparaison);
		if (v.sens === 'negatif') m.negatif = Math.max(m.negatif, g);
		else if (v.lue) m.lue = Math.max(m.lue, g);
		else m.main = Math.max(m.main, g);
		parSession.set(v.session, m);
	}
	let main = 0;
	let lue = 0;
	let negatifs = 0;
	for (const m of parSession.values()) {
		main += m.main;
		// une voix par session : la lecture ne compte que pour ce qu'elle ajoute au positif de l'utilisateur
		lue += Math.max(0, m.lue - m.main);
		negatifs += m.negatif;
	}
	const a = ALPHA_0 + main + Math.min(PLAFOND_LUE_APRES_CARTE, lue);
	const b = BETA_0 + negatifs;
	return Math.min(APRIORI_MAX, Math.max(-APRIORI_MAX, Math.log(a / b)));
}

/** Les voix de chaque fiche, à partir de tous les gestes du journal. */
export function voixParFiche(gestes: readonly GesteDApriori[]): Map<string, Voix[]> {
	const parFiche = new Map<string, GesteDApriori[]>();
	for (const g of gestes) {
		const liste = parFiche.get(g.fiche) ?? [];
		liste.push(g);
		parFiche.set(g.fiche, liste);
	}
	return new Map([...parFiche].map(([fiche, liste]) => [fiche, voixDesGestes(liste)]));
}

/**
 * L'a priori de chaque fiche qui a des voix (les autres : 0), pour le message courant ; la référence du cosinus relatif est
 * prise sur les messages de toutes les voix (hors session courante), chaque cosinus calculé une fois.
 */
export function aprioris(voix: ReadonlyMap<string, readonly Voix[]>, c: ContexteApriori): Map<string, number> {
	const autres = [...voix.values()].flat().filter((v) => v.session !== c.sessionCourante);
	const comparaison: Comparaison = { contexte: c, ...cosinusDesMessages(autres, c.vecteur) };
	return new Map([...voix].map(([fiche, v]) => [fiche, aprioriDesVoix(v, comparaison)]));
}

/** Une fiche que la règle des 3 sessions propose d'écarter toujours (jamais appliquée seule) : les sessions qui l'ont écartée. */
export type SuggestionEcarteeToujours = { fiche: string; sessions: string[]; jours: number; dernierEcartMs: number };

/**
 * Le jour local d'un instant (fuseau du processus) : « sur au moins 2 jours » se compte comme l'utilisateur les vit, minuit
 * local compris.
 */
export function jourLocal(ms: number): number {
	const d = new Date(ms);
	return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / JOUR_MS;
}

/**
 * Règle des 3 sessions : une fiche écartée (et pas rétablie dans la même session) dans au moins `SESSIONS_POUR_SUGGESTION`
 * sessions distinctes, sur au moins `JOURS_POUR_SUGGESTION` jours distincts (`jourDe`), sans injection demandée par
 * l'utilisateur depuis (une lecture de Claude ne compte pas : c'est la carte qui l'a menée à la fiche). Les fiches écartées
 * toujours n'y sont pas ; pour une fiche rétablie de « écartée toujours », seuls comptent les écarts d'après
 * (`retablissements` : fiche → instant du dernier rétablissement). Les plus récemment écartées d'abord.
 */
export function suggestionsEcarteeToujours(
	gestes: readonly GesteDApriori[],
	dejaEcarteesToujours: ReadonlySet<string>,
	retablissements: ReadonlyMap<string, number>,
	jourDe: (ms: number) => number,
): SuggestionEcarteeToujours[] {
	const parFiche = new Map<string, GesteDApriori[]>();
	for (const g of gestes) {
		if (dejaEcarteesToujours.has(g.fiche) || g.horodatageMs <= (retablissements.get(g.fiche) ?? -Infinity)) continue;
		const liste = parFiche.get(g.fiche) ?? [];
		liste.push(g);
		parFiche.set(g.fiche, liste);
	}
	const suggestions: SuggestionEcarteeToujours[] = [];
	for (const [fiche, liste] of parFiche) {
		// écarts en cours par session, remis à zéro par une injection demandée (toutes sessions) ou un rétablissement (sa session)
		let ecarts = new Map<string, number[]>();
		for (const g of chronologique(liste)) {
			if (g.geste === 'injectee_main') ecarts = new Map();
			else if (g.geste === 'retablie') ecarts.delete(g.session);
			else if (g.geste === 'ecartee_ici' || g.geste === 'ecartee_toujours') ecarts.set(g.session, [...(ecarts.get(g.session) ?? []), g.horodatageMs]);
		}
		const instants = [...ecarts.values()].flat();
		const jours = new Set(instants.map(jourDe)).size;
		if (ecarts.size >= SESSIONS_POUR_SUGGESTION && jours >= JOURS_POUR_SUGGESTION) {
			suggestions.push({ fiche, sessions: [...ecarts.keys()], jours, dernierEcartMs: Math.max(...instants) });
		}
	}
	return suggestions.sort((a, b) => b.dernierEcartMs - a.dernierEcartMs || a.fiche.localeCompare(b.fiche));
}

/** Fiche d'un identifiant de candidate (`fiche.md` ou `fiche.md#^f-0001`). */
export const ficheDeLIdentifiant = (id: string): string => id.split('#')[0]!;

/** Les candidates, sans celles dont la fiche est écartée toujours (exclue définitivement, partout, jusqu'à son rétablissement). */
export function sansEcarteesToujours<T>(candidates: readonly T[], ecarteesToujours: ReadonlySet<string>, idDe: (c: T) => string): T[] {
	if (ecarteesToujours.size === 0) return [...candidates];
	return candidates.filter((c) => !ecarteesToujours.has(ficheDeLIdentifiant(idDe(c))));
}
