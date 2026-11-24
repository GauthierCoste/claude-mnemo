/** Texte sans ses marques diacritiques (décomposition NFD, marques `\p{M}` retirées) ; la casse est gardée. */
export function sansAccents(texte: string): string {
	return texte.normalize('NFD').replace(/\p{M}/gu, '');
}

/** Forme de comparaison : sans accents, en minuscules. */
export function plier(texte: string): string {
	return sansAccents(texte).toLowerCase();
}

/** Texte rendu littéral dans le motif d'une expression régulière. */
export function echapperPourRegex(texte: string): string {
	return texte.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&');
}
