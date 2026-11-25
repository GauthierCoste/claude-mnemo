// Ce que le reranker lit (spec classement vivant § 3.6) : la requête et le texte de chaque fiche, tronqués pour tenir ensemble
// dans un emplacement du serveur (`-c 8192 -np 4` : 2 048 tokens par emplacement, la requête et le document y entrent
// ensemble). Le hook, l'outil `contexte`, l'affinage et le banc les forment ici : un même message donne le même logit. Pur.

/**
 * Au plus ce nombre de caractères pour la requête, et autant pour le texte d'une fiche : 3 000 caractères ensemble, soit
 * moins de 1 500 tokens même pour un texte dense (chiffres, code : environ 2 caractères par token), loin des 2 048.
 */
export const REQUETE_RERANKER_MAX = 1500;
export const DOCUMENT_RERANKER_MAX = 1500;

const COUPURE = ' … ';

/** Synthèse d'une fiche indexée : son texte est le titre, une ligne vide, puis la synthèse ; vide sans synthèse. */
export function syntheseDuTexte(texteIndexe: string): string {
	const coupe = texteIndexe.indexOf('\n\n');
	return coupe === -1 ? '' : texteIndexe.slice(coupe + 2).trim();
}

/**
 * La requête du reranker : la requête entière si elle tient ; sinon son début et sa fin (une requête jointe finit par le
 * message même), séparés par « … ». Coupée entre deux caractères, jamais au milieu d'un caractère composé de deux unités.
 */
export function requeteDuReranker(requete: string): string {
	const lettres = [...requete];
	if (lettres.length <= REQUETE_RERANKER_MAX) return requete;
	const garde = REQUETE_RERANKER_MAX - [...COUPURE].length;
	const debut = Math.ceil(garde / 2);
	return `${lettres.slice(0, debut).join('').trimEnd()}${COUPURE}${lettres.slice(lettres.length - (garde - debut)).join('').trimStart()}`;
}

/** Le texte d'une fiche pour le reranker : son titre, puis sa synthèse, coupés à `DOCUMENT_RERANKER_MAX` caractères. */
export function texteDuReranker(titre: string, texteIndexe: string): string {
	const lettres = [...`${titre}\n${syntheseDuTexte(texteIndexe)}`];
	return lettres.length <= DOCUMENT_RERANKER_MAX ? lettres.join('') : `${lettres.slice(0, DOCUMENT_RERANKER_MAX - 1).join('')}…`;
}
