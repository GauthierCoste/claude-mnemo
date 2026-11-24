export const RE_OUVERTURE = /^\s*(`{3,}|~{3,})(.*)$/u;
export const RE_FERMETURE = /^\s*(`{3,}|~{3,})\s*$/u;

/** Chaîne de clôture ouvrant un bloc sur cette ligne (``` ou ~~~, trois au moins), ou null. */
export function marqueDOuverture(ligne: string): string | null {
	const trouvee = RE_OUVERTURE.exec(ligne);
	if (trouvee === null) return null;
	// Une clôture ``` ne peut pas porter de ` dans sa chaîne d'information.
	if (trouvee[1]!.startsWith('`') && trouvee[2]!.includes('`')) return null;
	return trouvee[1]!;
}

/** La ligne ferme-t-elle un bloc ouvert par `marque` : même caractère, répété au moins autant de fois, seul sur la ligne ? */
export function fermeLe(marque: string, ligne: string): boolean {
	const fermeture = RE_FERMETURE.exec(ligne)?.[1];
	return fermeture !== undefined && fermeture[0] === marque[0] && fermeture.length >= marque.length;
}

/**
 * Suit les blocs de code clôturés, ligne après ligne. Un bloc s'ouvre par ``` ou ~~~ (trois au moins) et ne se ferme
 * que par le même caractère, répété au moins autant de fois, seul sur sa ligne.
 * La fonction renvoyée dit si la ligne appartient à un bloc (clôtures comprises).
 */
export function suivreBlocsDeCode(): (ligne: string) => boolean {
	let ouverture: string | null = null;
	return (ligne) => {
		if (ouverture === null) {
			ouverture = marqueDOuverture(ligne);
			return ouverture !== null;
		}
		if (fermeLe(ouverture, ligne)) ouverture = null;
		return true;
	};
}
