/**
 * Un fichier de configuration JSON d'un moteur (`hooks.json` de Codex), lu sans son BOM et réécrit avec son indentation, ses
 * fins de ligne et son BOM ; le reste est remis en forme (`JSON.stringify` : une valeur par ligne, espaces d'origine perdus).
 */

const BOM = '﻿';

/** Le texte sans son BOM (UTF-8) de tête, s'il en porte un. */
export const sansBom = (texte: string): string => (texte.startsWith(BOM) ? texte.slice(BOM.length) : texte);

/** Ce qu'un fichier JSON réécrit garde : indentation, fin de ligne, BOM de tête. */
export type StyleJson = { indentation: string; finDeLigne: '\n' | '\r\n'; bom: boolean };

/**
 * Style du texte : l'indentation de sa première ligne indentée (tabulation, ou ses espaces ; deux espaces par défaut), CRLF
 * s'il en porte un, son BOM.
 */
export function styleJson(texte: string | null): StyleJson {
	const ligne = texte?.split(/\r?\n/u).find((l) => /^[ \t]+\S/u.test(l));
	const indentation = ligne === undefined ? '  ' : ligne.startsWith('\t') ? '\t' : /^ +/u.exec(ligne)![0];
	return { indentation, finDeLigne: texte?.includes('\r\n') === true ? '\r\n' : '\n', bom: texte?.startsWith(BOM) === true };
}

/** La valeur en texte JSON dans ce style, avec une fin de ligne finale. */
export const texteJson = (valeur: unknown, style: StyleJson): string =>
	`${style.bom ? BOM : ''}${JSON.stringify(valeur, null, style.indentation).replace(/\n/gu, style.finDeLigne)}${style.finDeLigne}`;

/**
 * Texte d'un fichier JSON réécrit par Mnemo (`hooks.json` de Codex) : la valeur dans le style
 * du texte lu (`texteLu` null : fichier nouveau, deux espaces et `\n`).
 */
export const texteJsonReecrit = (valeur: unknown, texteLu: string | null): string => texteJson(valeur, styleJson(texteLu));
