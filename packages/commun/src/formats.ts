import { estBinaire } from './encodage.ts';

/**
 * Formats lus par un extracteur dédié (extensions en minuscules). Tout autre fichier est lu comme du texte, s'il en est ;
 * un fichier binaire d'un autre format est gardé, mais pas cherchable (`avertissementNonCherchable`).
 */
export const EXTENSIONS_EXTRAITES = ['.pdf', '.docx', '.eml', '.mbox'] as const;

/** Extension du dernier segment du chemin, en minuscules (avec le point), ou null. */
export function extensionDe(chemin: string): string | null {
	const nom = chemin.split(/[\\/]/u).pop() ?? '';
	const point = nom.lastIndexOf('.');
	return point < 0 ? null : nom.slice(point).toLowerCase();
}

/** Vrai si le fichier a un extracteur dédié (`EXTENSIONS_EXTRAITES`) ; sinon il est lu comme du texte. */
export function aUnExtracteurDedie(chemin: string): boolean {
	const extension = extensionDe(chemin);
	return extension !== null && (EXTENSIONS_EXTRAITES as readonly string[]).includes(extension);
}

/** Pourquoi un fichier ne sera pas cherchable : ni texte, ni format extrait. */
export const RAISON_NON_CHERCHABLE = `pas un fichier texte, et son format n'a pas d'extracteur (formats lus : ${EXTENSIONS_EXTRAITES.join(', ')}, et tout fichier texte)`;

/** L'avertissement d'un fichier gardé mais pas cherchable : dit au dépôt, à l'extraction et sur la fiche de la source. */
export const avertissementNonCherchable = (chemin: string): string => `« ${chemin} » : ${RAISON_NON_CHERCHABLE} ; il est gardé, mais ne sera pas cherchable`;

/** Vrai si le fichier sera lu : extracteur dédié, ou texte d'après ses premiers octets (`ECHANTILLON_NATURE`). */
export function estCherchable(chemin: string, debut: Uint8Array): boolean {
	return aUnExtracteurDedie(chemin) || !estBinaire(debut);
}

/** Null si le fichier sera lu (`estCherchable`) ; sinon pourquoi : dit au dépôt, à l'extraction et sur la fiche de la source. */
export function motifSiNonCherchable(chemin: string, debut: Uint8Array): string | null {
	return estCherchable(chemin, debut) ? null : avertissementNonCherchable(chemin);
}
