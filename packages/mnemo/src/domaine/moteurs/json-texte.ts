/**
 * Un fichier de configuration JSON d'un moteur (GitHub Copilot CLI lit les siens en JSONC : commentaires et virgules finales
 * permis), lu avec tolérance et réécrit dans son style (indentation, fins de ligne).
 */

/** Le texte sans commentaires (`//`, `/* … *\/`) ni virgules finales, les chaînes intactes : du JSON si le reste en est. */
export function sansCommentairesJson(texte: string): string {
	let sortie = '';
	let i = 0;
	while (i < texte.length) {
		const c = texte[i]!;
		if (c === '"') {
			let j = i + 1;
			while (j < texte.length && texte[j] !== '"') j += texte[j] === '\\' ? 2 : 1;
			sortie += texte.slice(i, j + 1);
			i = j + 1;
		} else if (c === '/' && texte[i + 1] === '/') {
			while (i < texte.length && texte[i] !== '\n') i++;
		} else if (c === '/' && texte[i + 1] === '*') {
			const fin = texte.indexOf('*/', i + 2);
			i = fin === -1 ? texte.length : fin + 2;
		} else {
			sortie += c;
			i++;
		}
	}
	return sansVirgulesFinales(sortie);
}

/** Les virgules suivies (blancs mis à part) d'une accolade ou d'un crochet fermants retirées, hors des chaînes. */
function sansVirgulesFinales(texte: string): string {
	let sortie = '';
	let i = 0;
	while (i < texte.length) {
		const c = texte[i]!;
		if (c === '"') {
			let j = i + 1;
			while (j < texte.length && texte[j] !== '"') j += texte[j] === '\\' ? 2 : 1;
			sortie += texte.slice(i, j + 1);
			i = j + 1;
			continue;
		}
		if (c === ',' && /^\s*[}\]]/u.test(texte.slice(i + 1))) {
			i++;
			continue;
		}
		sortie += c;
		i++;
	}
	return sortie;
}

/**
 * Valeur d'un texte JSONC ; `jsonc` : il porte des commentaires ou des virgules finales (Mnemo ne le réécrit pas : il les
 * perdrait). Texte vide : un objet vide.
 */
export function lireJsonc(texte: string): { valeur: unknown; jsonc: boolean } | { echec: string } {
	if (texte.trim() === '') return { valeur: {}, jsonc: false };
	const propre = sansCommentairesJson(texte);
	try {
		return { valeur: JSON.parse(propre), jsonc: propre !== texte };
	} catch (erreur) {
		return { echec: `JSON illisible (${erreur instanceof Error ? erreur.message : String(erreur)})` };
	}
}

/** Style d'écriture d'un fichier JSON : indentation et fin de ligne. */
export type StyleJson = { indentation: string; finDeLigne: '\n' | '\r\n' };

/**
 * Style du texte : l'indentation de sa première ligne indentée (tabulation, ou ses espaces ; deux espaces par défaut), CRLF
 * s'il en porte un.
 */
export function styleJson(texte: string | null): StyleJson {
	const ligne = texte?.split(/\r?\n/u).find((l) => /^[ \t]+\S/u.test(l));
	const indentation = ligne === undefined ? '  ' : ligne.startsWith('\t') ? '\t' : /^ +/u.exec(ligne)![0];
	return { indentation, finDeLigne: texte?.includes('\r\n') === true ? '\r\n' : '\n' };
}

/** La valeur en texte JSON dans ce style, avec une fin de ligne finale. */
export const texteJson = (valeur: unknown, style: StyleJson): string => `${JSON.stringify(valeur, null, style.indentation).replace(/\n/gu, style.finDeLigne)}${style.finDeLigne}`;
