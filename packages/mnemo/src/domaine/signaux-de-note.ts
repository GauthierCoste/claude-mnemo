// Signaux bruts d'une fiche candidate pour un message (spec classement vivant § 4.2) : ce que la note apprise combinera. Pur.
//
// Le hook (`application/cartes.ts`) et le banc du contexte les calculent par les mêmes règles : un même message donne les
// mêmes signaux des deux côtés.

/**
 * Signaux bruts d'une candidate. `cosinus` : similarité de sens du message et de la fiche (null : pas de vecteur, du message ou
 * de la fiche) ; `cosinusRelatif` : ce cosinus moins la médiane des cosinus de toutes les fiches de la mémoire pour ce message ;
 * `cosinusZ` : sa variante z-score, l'écart du cosinus à la moyenne de ces cosinus rapporté à leur écart-type (le banc choisit
 * l'une des deux ; null : pas de cosinus, ou des cosinus tous égaux) ;
 * `bm25Relatif` : le bm25 de la fiche rapporté au meilleur de sa liste de mots (0 : les mots ne la trouvent pas ; null : le
 * message n'a pas de mots cherchables) ; `signalSession` : le poids des signaux de la session (voisine d'une fiche injectée à la
 * main), 0 sans signal ; `apriori` : l'a priori des gestes entre sessions (`domaine/apriori-gestes.ts`, en logit, borné à ±1),
 * 0 sans geste ou sans le service qui le tient. Il est journalisé seulement : il ne change ni l'ordre ni les pistes.
 */
export type SignauxBruts = {
	cosinus: number | null;
	cosinusRelatif: number | null;
	cosinusZ: number | null;
	bm25Relatif: number | null;
	signalSession: number;
	apriori: number;
};

/** Médiane ; null pour une liste vide. */
export function mediane(valeurs: readonly number[]): number | null {
	if (valeurs.length === 0) return null;
	const triees = [...valeurs].sort((a, b) => a - b);
	const m = Math.floor(triees.length / 2);
	return triees.length % 2 === 1 ? triees[m]! : (triees[m - 1]! + triees[m]!) / 2;
}

/** Moyenne et écart-type (de la population) ; null pour une liste vide. */
export function moyenneEtEcartType(valeurs: readonly number[]): { moyenne: number; ecartType: number } | null {
	if (valeurs.length === 0) return null;
	const moyenne = valeurs.reduce((s, v) => s + v, 0) / valeurs.length;
	const variance = valeurs.reduce((s, v) => s + (v - moyenne) ** 2, 0) / valeurs.length;
	return { moyenne, ecartType: Math.sqrt(variance) };
}

/** Ce que les cosinus de toute la mémoire disent d'un message : la médiane (cosinus relatif), la moyenne et l'écart-type (z-score). */
export type CosinusDuMessage = { parFiche: Map<string, number>; mediane: number | null; moyenne: number | null; ecartType: number | null };

/**
 * Cosinus de chaque fiche (la première similarité vue de chaque chemin : `proches` est rangé du plus proche au moins proche),
 * leur médiane, leur moyenne et leur écart-type. bge-m3 tasse les cosinus dans [0,6 ; 1] : seul l'écart à ce que la mémoire
 * entière donne pour le message sépare une fiche proche d'une autre d'un message à l'autre.
 */
export function cosinusDesFiches(proches: readonly { chemin: string; similarite: number }[]): CosinusDuMessage {
	const parFiche = new Map<string, number>();
	for (const p of proches) if (!parFiche.has(p.chemin) && Number.isFinite(p.similarite)) parFiche.set(p.chemin, p.similarite);
	const valeurs = [...parFiche.values()];
	const stats = moyenneEtEcartType(valeurs);
	return { parFiche, mediane: mediane(valeurs), moyenne: stats?.moyenne ?? null, ecartType: stats?.ecartType ?? null };
}

/** Cosinus relatif : le cosinus moins la médiane ; null sans l'un des deux. */
export function cosinusRelatif(cosinus: number | null, medianeDesCosinus: number | null): number | null {
	return cosinus === null || medianeDesCosinus === null ? null : cosinus - medianeDesCosinus;
}

/** Sous cet écart-type, les cosinus sont tenus pour égaux (arrondis du calcul) : le z-score ne dirait rien. */
const ECART_TYPE_MIN = 1e-9;

/** Variante z-score : l'écart du cosinus à la moyenne, en écarts-types ; null sans l'un d'eux, ou si les cosinus sont tous égaux. */
export function cosinusZ(cosinus: number | null, cos: Pick<CosinusDuMessage, 'moyenne' | 'ecartType'> | null): number | null {
	if (cosinus === null || cos === null || cos.moyenne === null || cos.ecartType === null || !(cos.ecartType > ECART_TYPE_MIN)) return null;
	return (cosinus - cos.moyenne) / cos.ecartType;
}

/**
 * `r` d'un élément trouvé par une liste de mots : son bm25 (négatif : plus il l'est, mieux il correspond) rapporté au meilleur
 * (le plus négatif) de la liste, dans [0, 1]. 1 sans bm25, ou si la liste n'en a aucun négatif (`meilleur` null) ; 0 pour un
 * bm25 nul ou positif dans une liste qui en a de négatifs (aucun mot ne compte).
 */
export function bm25Relatif(bm25: number | undefined, meilleur: number | null): number {
	if (meilleur === null || bm25 === undefined || !Number.isFinite(bm25)) return 1;
	return bm25 < 0 ? Math.min(1, bm25 / meilleur) : 0;
}

/** Le meilleur bm25 (le plus négatif) d'une liste ; null si elle n'en a aucun négatif. */
export function meilleurBm25(bm25s: readonly (number | undefined)[]): number | null {
	let meilleur: number | null = null;
	for (const b of bm25s) if (b !== undefined && Number.isFinite(b) && b < 0 && (meilleur === null || b < meilleur)) meilleur = b;
	return meilleur;
}

/**
 * bm25 relatif de chaque fiche trouvée par des listes de mots, dans l'ordre des listes (`toutes` les mots, puis `une`) : une
 * fiche prend le `r` de la première liste où elle paraît. `ordre` : les fiches trouvées, dans l'ordre des listes.
 */
export function bm25RelatifsDesListes(listes: readonly (readonly { chemin: string; bm25?: number }[])[]): { relatifs: Map<string, number>; ordre: string[] } {
	const relatifs = new Map<string, number>();
	const ordre: string[] = [];
	for (const liste of listes) {
		const meilleur = meilleurBm25(liste.map((e) => e.bm25));
		for (const e of liste) {
			if (relatifs.has(e.chemin)) continue;
			relatifs.set(e.chemin, bm25Relatif(e.bm25, meilleur));
			ordre.push(e.chemin);
		}
	}
	return { relatifs, ordre };
}
