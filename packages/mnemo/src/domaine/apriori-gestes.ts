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
 * Écart de cosinus à la médiane qui mène la ressemblance d'une borne à l'autre : bge-m3 tasse les cosinus dans [0,6 ; 1],
 * seul l'écart à la médiane des messages des gestes sépare quelque chose.
 */
export const ECHELLE_COSINUS_RELATIF = 0.15;
/** `lue_apres_carte` : positif, mais c'est Claude qui lit, pas l'utilisateur qui demande. */
export const POIDS_LUE_APRES_CARTE = 0.5;
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
	sens: Sens;
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
		const base = { session: g.session, horodatageMs: g.horodatageMs, dossier: g.dossier, position: g.position, vecteur: g.vecteur };
		switch (g.geste) {
			case 'injectee_main':
				voix.push({ ...base, sens: 'positif', poids: 1 });
				break;
			case 'lue_apres_carte':
				voix.push({ ...base, sens: 'positif', poids: POIDS_LUE_APRES_CARTE });
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
		}
	}
	return [...parSession.values()].flat();
}

/** Médiane des cosinus du message courant aux messages des voix (même modèle, même dimension) ; null s'il n'y en a aucun. */
export function medianeDesCosinus(voix: readonly Pick<Voix, 'vecteur'>[], courant: VecteurDApriori | null): number | null {
	if (courant === null) return null;
	const valeurs = voix.flatMap((v) => (comparables(v.vecteur, courant) ? [cosinus(v.vecteur!.valeurs, courant.valeurs)] : [])).sort((a, b) => a - b);
	if (valeurs.length === 0) return null;
	const milieu = Math.floor(valeurs.length / 2);
	return valeurs.length % 2 === 1 ? valeurs[milieu]! : (valeurs[milieu - 1]! + valeurs[milieu]!) / 2;
}

function comparables(a: VecteurDApriori | null, b: VecteurDApriori | null): boolean {
	return a !== null && b !== null && a.modele === b.modele && a.valeurs.length === b.valeurs.length && a.valeurs.length > 0;
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
 * Cosinus du message du geste au message courant, relatif à la médiane (`cos − médiane`), ramené dans [0,5 ; 1] : 0,75 à
 * la médiane, les bornes à ±`ECHELLE_COSINUS_RELATIF`. 0,75 si l'un des vecteurs manque ou si leurs modèles diffèrent.
 */
export function ressemblance(v: VecteurDApriori | null, courant: VecteurDApriori | null, mediane: number | null): number {
	if (!comparables(v, courant) || mediane === null) return RESSEMBLANCE_INCONNUE;
	const relatif = cosinus(v!.valeurs, courant!.valeurs) - mediane;
	const r = RESSEMBLANCE_INCONNUE + ((RESSEMBLANCE_MAX - RESSEMBLANCE_MIN) / 2) * (relatif / ECHELLE_COSINUS_RELATIF);
	return Math.min(RESSEMBLANCE_MAX, Math.max(RESSEMBLANCE_MIN, r));
}

/** Poids `g` d'une voix pour le message courant : poids propre × décroissance × lieu × ressemblance. */
export function poidsDeLaVoix(v: Voix, c: ContexteApriori, mediane: number | null): number {
	return v.poids * decroissance(c.maintenantMs - v.horodatageMs) * lieu(v, c) * ressemblance(v.vecteur, c.vecteur, mediane);
}

/**
 * A priori d'une fiche, en logit : une voix par session et par sens (le plus fort `g`, pas la somme), la session courante
 * exclue ; `a = α₀ + Σ g⁺`, `b = β₀ + Σ g⁻`, `log(a / b)` borné à ±`APRIORI_MAX`. 0 sans voix.
 */
export function aprioriDesVoix(voix: readonly Voix[], c: ContexteApriori, mediane: number | null): number {
	const meilleures = new Map<string, number>();
	for (const v of voix) {
		if (v.session === c.sessionCourante) continue;
		const cle = `${v.sens}\u0000${v.session}`;
		meilleures.set(cle, Math.max(meilleures.get(cle) ?? 0, poidsDeLaVoix(v, c, mediane)));
	}
	let a = ALPHA_0;
	let b = BETA_0;
	for (const [cle, g] of meilleures) {
		if (cle.startsWith('positif')) a += g;
		else b += g;
	}
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

/** L'a priori de chaque fiche qui a des voix (les autres : 0), pour le message courant ; la médiane est prise sur toutes les voix. */
export function aprioris(voix: ReadonlyMap<string, readonly Voix[]>, c: ContexteApriori): Map<string, number> {
	const autres = [...voix.values()].flat().filter((v) => v.session !== c.sessionCourante);
	const mediane = medianeDesCosinus(autres, c.vecteur);
	return new Map([...voix].map(([fiche, v]) => [fiche, aprioriDesVoix(v, c, mediane)]));
}

/** Une fiche que la règle des 3 sessions propose d'écarter toujours (jamais appliquée seule) : les sessions qui l'ont écartée. */
export type SuggestionEcarteeToujours = { fiche: string; sessions: string[]; jours: number; dernierEcartMs: number };

const POSITIFS: ReadonlySet<Geste> = new Set<Geste>(['injectee_main', 'lue_apres_carte']);

/**
 * Règle des 3 sessions : une fiche écartée (et pas rétablie dans la même session) dans au moins `SESSIONS_POUR_SUGGESTION`
 * sessions distinctes, sur au moins `JOURS_POUR_SUGGESTION` jours distincts, sans geste positif depuis le premier de ces
 * écarts. Les fiches déjà écartées toujours n'y sont pas. `jourDe` : le jour d'un instant (défaut : jour UTC). Les plus
 * récemment écartées d'abord.
 */
export function suggestionsEcarteeToujours(
	gestes: readonly GesteDApriori[],
	dejaEcarteesToujours: ReadonlySet<string>,
	jourDe: (ms: number) => number = (ms) => Math.floor(ms / JOUR_MS),
): SuggestionEcarteeToujours[] {
	const parFiche = new Map<string, GesteDApriori[]>();
	for (const g of gestes) {
		if (dejaEcarteesToujours.has(g.fiche)) continue;
		const liste = parFiche.get(g.fiche) ?? [];
		liste.push(g);
		parFiche.set(g.fiche, liste);
	}
	const suggestions: SuggestionEcarteeToujours[] = [];
	for (const [fiche, liste] of parFiche) {
		// écarts en cours par session, remis à zéro par un geste positif (toutes sessions) ou un rétablissement (sa session)
		let ecarts = new Map<string, number[]>();
		for (const g of chronologique(liste)) {
			if (POSITIFS.has(g.geste)) ecarts = new Map();
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
