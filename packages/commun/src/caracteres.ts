/**
 * Caractères refusés dans un nom ou un chemin reçu (nom déposé, chemins d'un lot, marqueur de projet des réglages) :
 * contrôles C0, DEL, C1, et marques de direction (U+061C, U+200E, U+200F, U+202A-U+202E, U+2066-U+2069) qui maquillent un
 * nom à l'affichage. Sans drapeau `g` : `test` sans état.
 */
export const CARACTERES_INVISIBLES = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

const CARACTERES_INVISIBLES_TOUS = new RegExp(CARACTERES_INVISIBLES.source, 'gu');

/** Nom montré dans un message (service ou interface) : chaque caractère de `CARACTERES_INVISIBLES` écrit `\uXXXX`. */
export function nomAffichable(nom: string): string {
	return nom.replace(CARACTERES_INVISIBLES_TOUS, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** Nom d'un fichier ou d'un dossier NOUVEAU (dépôt) : ni vide, ni « . » ou « .. », ni séparateur, ni caractère invisible. */
export function nomDeFichierNouveauValide(nom: string): { ok: true; nom: string } | { ok: false; motif: string } {
	if (nom === '' || nom === '.' || nom === '..') return { ok: false, motif: 'nom de fichier vide, « . » ou « .. »' };
	if (/[/\\]/u.test(nom)) return { ok: false, motif: 'séparateur de chemin dans le nom' };
	if (CARACTERES_INVISIBLES.test(nom)) return { ok: false, motif: 'caractère invisible ou de contrôle dans le nom' };
	return { ok: true, nom };
}
