/**
 * Taille maximale d'un document : dépôt de l'interface (`depot`) et document référencé (`extraire_source`). Le dépôt est
 * écrit en flux ; l'extraction a ses propres limites par format (PDF, Word, courriel), plus basses, parce que ces
 * bibliothèques lisent le fichier entier en mémoire.
 */
export const TAILLE_MAX_DOCUMENT = 10 * 1024 ** 3;

/** Taille lisible en unités binaires françaises : « 512 octets », « 50 Mo », « 1,5 Go » (une décimale au plus). */
export function tailleLisible(octets: number): string {
	const unites = ['octets', 'Ko', 'Mo', 'Go', 'To'];
	let valeur = octets;
	let rang = 0;
	while (valeur >= 1024 && rang < unites.length - 1) {
		valeur /= 1024;
		rang++;
	}
	return `${String(Math.round(valeur * 10) / 10).replace('.', ',')} ${unites[rang]}`;
}
