/**
 * Pourquoi une carte est proposée : fiche du périmètre de la position, fiche nommée dans le message, fiche proche de la question,
 * fiche liée à une fiche injectée à la main.
 */
export type RaisonCarte = 'perimetre' | 'nommee' | 'question' | 'liee';

/** Libellé de la raison d'une carte proposée. */
export const RAISONS_CARTE: Record<RaisonCarte, string> = { perimetre: 'du périmètre', nommee: 'nommée', question: 'question', liee: 'liée' };

/**
 * Libellé affiché d'une raison. Toute raison qui porte un `depuis` (la raison d'un signal : la fiche d'où vient le poids, la fiche
 * injectée à la main pour `liee`) reçoit le suffixe « à <titre> » quand ce titre est connu : « liée à Avoirs ».
 */
export function libelleRaison(raison: RaisonCarte, titreDepuis?: string | null): string {
	return titreDepuis === undefined || titreDepuis === null || titreDepuis === '' ? RAISONS_CARTE[raison] : `${RAISONS_CARTE[raison]} à ${titreDepuis}`;
}
