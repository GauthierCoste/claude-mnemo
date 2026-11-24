// Découpe de texte sûre : jamais une moitié de paire de substitution. Aucun module `node:` ici.

/**
 * Le plus long début de `texte` qui tient en `max` : en points de code (`points`, par défaut), ou en unités UTF-16
 * (`utf16`, la longueur JavaScript, pour une borne exprimée en `length`). Ne coupe jamais un caractère en deux.
 */
export function tronquerTexte(texte: string, max: number, mesure: 'points' | 'utf16' = 'points'): string {
	// Position de coupe, puis une seule copie : concaténer caractère par caractère laisserait une corde d'un nœud par
	// caractère (des kilo-octets par texte gardé).
	if (mesure === 'utf16' && texte.length <= max) return texte;
	let fin = 0;
	let compte = 0;
	while (fin < texte.length) {
		const code = texte.charCodeAt(fin);
		const paire = code >= 0xd800 && code <= 0xdbff && fin + 1 < texte.length && (texte.charCodeAt(fin + 1) & 0xfc00) === 0xdc00;
		const unites = paire ? 2 : 1;
		const taille = mesure === 'points' ? 1 : unites;
		if (compte + taille > max) break;
		compte += taille;
		fin += unites;
	}
	return fin === texte.length ? texte : texte.slice(0, fin);
}

/** Message lisible d'une erreur quelconque. */
export function messageDErreur(erreur: unknown): string {
	return erreur instanceof Error ? erreur.message : String(erreur);
}

/** Noms cités par une ligne qui les compte ; les suivants sont seulement comptés. */
export const NOMS_CITES_MAX = 5;

/** « a, b, c, d, e, … » : les `NOMS_CITES_MAX` premiers noms, suivis de « … » s'il y en a d'autres. */
export function premiersNoms(noms: readonly string[]): string {
	return `${noms.slice(0, NOMS_CITES_MAX).join(', ')}${noms.length > NOMS_CITES_MAX ? ', …' : ''}`;
}
