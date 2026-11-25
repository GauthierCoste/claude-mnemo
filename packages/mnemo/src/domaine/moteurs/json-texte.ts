/**
 * Un fichier de configuration JSON d'un moteur (GitHub Copilot CLI lit les siens en JSONC : commentaires et virgules finales
 * permis), lu avec tolérance (BOM compris) et réécrit avec son indentation, ses fins de ligne et son BOM ; le reste est remis
 * en forme (`JSON.stringify` : une valeur par ligne, espaces d'origine perdus).
 */

const BOM = '﻿';

/** Le texte sans son BOM (UTF-8) de tête, s'il en porte un. */
export const sansBom = (texte: string): string => (texte.startsWith(BOM) ? texte.slice(BOM.length) : texte);

/** Fin d'une chaîne JSON qui s'ouvre à `debut` (guillemet) : l'index qui suit son guillemet fermant. */
function finDeChaine(texte: string, debut: number): number {
	let j = debut + 1;
	while (j < texte.length && texte[j] !== '"') j += texte[j] === '\\' ? 2 : 1;
	return j + 1;
}

/** Fin d'un commentaire qui commence à `i` (`//` ou `/*`), ou `i` s'il n'y en a pas. */
function finDeCommentaire(texte: string, i: number): number {
	if (texte[i] !== '/') return i;
	if (texte[i + 1] === '/') {
		const fin = texte.indexOf('\n', i + 2);
		return fin === -1 ? texte.length : fin;
	}
	if (texte[i + 1] === '*') {
		const fin = texte.indexOf('*/', i + 2);
		return fin === -1 ? texte.length : fin + 2;
	}
	return i;
}

/** Premier caractère après `i` qui n'est ni un blanc ni dans un commentaire (undefined : fin du texte). */
function suivantSignificatif(texte: string, i: number): string | undefined {
	let j = i;
	while (j < texte.length) {
		if (/\s/u.test(texte[j]!)) j++;
		else {
			const fin = finDeCommentaire(texte, j);
			if (fin === j) return texte[j];
			j = fin;
		}
	}
	return undefined;
}

/**
 * Le texte sans commentaires (`//`, `/* … *\/`) ni virgules finales (suivies, blancs et commentaires mis à part, d'une
 * accolade ou d'un crochet fermants), les chaînes intactes, en une passe : du JSON si le reste en est.
 */
export function sansCommentairesJson(texte: string): string {
	let sortie = '';
	let i = 0;
	while (i < texte.length) {
		const c = texte[i]!;
		if (c === '"') {
			const fin = finDeChaine(texte, i);
			sortie += texte.slice(i, fin);
			i = fin;
			continue;
		}
		const finCommentaire = finDeCommentaire(texte, i);
		if (finCommentaire !== i) {
			i = finCommentaire;
			continue;
		}
		const suivant = c === ',' ? suivantSignificatif(texte, i + 1) : undefined;
		if (suivant !== '}' && suivant !== ']') sortie += c;
		i++;
	}
	return sortie;
}

/**
 * Valeur d'un texte JSONC (son BOM retiré) ; `jsonc` : il porte des commentaires ou des virgules finales (Mnemo ne le réécrit
 * pas : il les perdrait). Texte vide : un objet vide.
 */
export function lireJsonc(texte: string): { valeur: unknown; jsonc: boolean } | { echec: string } {
	const json = sansBom(texte);
	if (json.trim() === '') return { valeur: {}, jsonc: false };
	const propre = sansCommentairesJson(json);
	try {
		return { valeur: JSON.parse(propre), jsonc: propre !== json };
	} catch (erreur) {
		return { echec: `JSON illisible (${erreur instanceof Error ? erreur.message : String(erreur)})` };
	}
}

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
 * Texte d'un fichier JSON réécrit par Mnemo (hooks de Codex et de GitHub Copilot CLI, déclaration MCP) : la valeur dans le style
 * du texte lu (`texteLu` null : fichier nouveau, deux espaces et `\n`).
 */
export const texteJsonReecrit = (valeur: unknown, texteLu: string | null): string => texteJson(valeur, styleJson(texteLu));
