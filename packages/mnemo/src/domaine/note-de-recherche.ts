// Note unique d'un résultat de recherche : `note = base + Σ poids`. Pur.
//
// La base dit ce que la requête désigne (pertinence de 0 à 1). Chaque poids nommé ajoute (ou retire) une fraction de cette
// échelle : position dans le voisinage du projet courant, confiance, appartenance à la mémoire, fraîcheur. Les poids sont des
// réglages (`recherche.poids*`) ; un apport nul n'est pas listé dans la note. Le libellé visible (`libelleApports`) ne dit que
// ce qui distingue un résultat : le projet courant, une confiance basse, « récent » pour un élément daté de moins d'un an ;
// l'apport de la mémoire et la fraîcheur d'un élément sans date ou ancien, qui touchent presque tout, ne sont pas dits.

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const MS_PAR_JOUR = 86_400_000;

export type NomPoids = 'position' | 'confiance' | 'memoire' | 'fraicheur';

/**
 * Ce qu'un poids ajoute (valeur positive) ou retire (négative) à la note ; l'apport `confiance` porte celle du résultat,
 * l'apport `fraicheur` la fraîcheur de l'élément (null : sans date), pour les dire.
 */
export type ApportRecherche =
	| { poids: 'confiance'; valeur: number; confiance: number }
	| { poids: 'fraicheur'; valeur: number; fraicheur: number | null }
	| { poids: 'position' | 'memoire'; valeur: number };

export type NoteRecherche = { base: number; apports: ApportRecherche[]; total: number };

export type PoidsRecherche = { position: number; confiance: number; memoire: number; fraicheur: number };

export const POIDS_RECHERCHE_PAR_DEFAUT: PoidsRecherche = { position: 0.1, confiance: 0.1, memoire: 0.05, fraicheur: 0.05 };

/** Ce que l'on sait d'un résultat, hors sa base. */
export type Faits = {
	dansVoisinage: boolean;
	/** De 0 à 1 ; 1 : sûr. */
	confiance: number;
	deLaMemoire: boolean;
	date: string | null;
	aujourdhui: string;
};

function jours(date: string): number {
	const [a, m, j] = date.split('-').map(Number);

	return Date.UTC(a!, m! - 1, j!) / MS_PAR_JOUR;
}

/** Fraîcheur à partir de laquelle un élément daté est dit « récent » (moins d'un an). */
export const FRAICHEUR_RECENTE = 0.5;

const estDatee = (date: string | null, aujourdhui: string): date is string => date !== null && RE_DATE.test(date) && RE_DATE.test(aujourdhui);

/** Fraîcheur de 0 à 1 : 1 aujourd'hui (ou sans date, ou date mal formée), la moitié après un an. */
export function fraicheur(date: string | null, aujourdhui: string): number {
	if (!estDatee(date, aujourdhui)) return 1;
	const age = Math.max(0, jours(aujourdhui) - jours(date));

	return 2 ** (-age / 365);
}

export function noterRecherche(base: number, faits: Faits, poids: PoidsRecherche): NoteRecherche {
	const apports: ApportRecherche[] = [];
	if (faits.dansVoisinage && poids.position !== 0) apports.push({ poids: 'position', valeur: poids.position });
	const retrait = -poids.confiance * (1 - faits.confiance);
	if (retrait !== 0) apports.push({ poids: 'confiance', valeur: retrait, confiance: faits.confiance });
	if (faits.deLaMemoire && poids.memoire !== 0) apports.push({ poids: 'memoire', valeur: poids.memoire });
	const f = fraicheur(faits.date, faits.aujourdhui);
	const frais = poids.fraicheur * f;
	if (frais !== 0) apports.push({ poids: 'fraicheur', valeur: frais, fraicheur: estDatee(faits.date, faits.aujourdhui) ? f : null });

	return { base, apports, total: apports.reduce((somme, a) => somme + a.valeur, base) };
}

/** Raison dite d'un apport, ou null s'il ne distingue pas le résultat (mémoire ; fraîcheur sans date ou de plus d'un an). */
function enClair(a: ApportRecherche): string | null {
	switch (a.poids) {
		case 'position':
			return 'projet courant';
		case 'confiance':
			return `confiance ${Math.round(a.confiance * 100)} %`;
		case 'memoire':
			return null;
		case 'fraicheur':
			return a.fraicheur !== null && a.fraicheur >= FRAICHEUR_RECENTE ? 'récent' : null;
	}
}

/** Base affichée : virgule, 2 décimales (« 0,82 »). */
export const baseEnClair = (base: number): string => base.toFixed(2).replace('.', ',');

/** Raison lisible de la note : la base (virgule, 2 décimales), puis les apports qui distinguent le résultat, en clair. */
export function libelleApports(n: Pick<NoteRecherche, 'base' | 'apports'>): string {
	const base = baseEnClair(n.base);
	const raisons = n.apports.map(enClair).filter((r) => r !== null);

	return raisons.length === 0 ? base : `${base} · ${raisons.join(', ')}`;
}
