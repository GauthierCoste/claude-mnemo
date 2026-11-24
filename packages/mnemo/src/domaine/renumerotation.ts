import { prochaineAncre } from './fiche.ts';
import type { Fiche, LigneDeFait } from './fiche.ts';
import type { Fait } from './fait.ts';
import { aliasDeSuite, aliasGarde, sansMd } from './liens-ecrits.ts';

/**
 * Renumérotation des informations qui changent de fiche (fusion de fiches, déplacement d'informations) : nouvelles ancres
 * dans la fiche qui les reçoit, renvois (`contredit`, `invalidé … par`) et liens `[[fiche#^f-X]]` suivis.
 */
export type TableDeRenumerotation = ReadonlyMap<string, string>;

const RE_ANCRE_BRUTE = / \^(f-\d{4,9})$/u;
/** Renvoi d'une ligne brute vers une ancre de la même fiche : pas `[[autre#^f-…]]`, qui vise une autre fiche. */
const RE_RENVOI = /(?<!#)\^(f-\d{4,9})\b/gu;
const RE_SUITE_ANCRE = /^#\^(f-\d{4,9})(.*)$/u;

/** Ancre d'une ligne brute (` ^f-X` en fin de ligne), sinon undefined. */
export const ancreDeLigneBrute = (ligne: string): string | undefined => RE_ANCRE_BRUTE.exec(ligne)?.[1];

/** Ancres renvoyées par une ligne brute (`^f-X` hors d'un lien `[[…#^f-X]]`), son ancre propre comprise. */
export const renvoisDeLigneBrute = (ligne: string): string[] => [...ligne.matchAll(RE_RENVOI)].map((t) => t[1]!);

/**
 * Nouvelles ancres des informations de `lignes`, dans l'ordre du document, à la suite de la plus haute ancre de la fiche
 * `receveuse` : aucune collision.
 */
export function renumerotation(lignes: readonly LigneDeFait[], receveuse: Fiche): Map<string, string> {
	let numero = Number(prochaineAncre(receveuse).slice(2));
	const table = new Map<string, string>();
	const noter = (ancre: string | undefined) => {
		if (ancre === undefined || table.has(ancre)) return;
		table.set(ancre, `f-${String(numero++).padStart(4, '0')}`);
	};
	for (const ligne of lignes) {
		if ('fait' in ligne) noter(ligne.fait.ancre);
		else for (const brute of ligne.brute) noter(ancreDeLigneBrute(brute));
	}
	return table;
}

/**
 * L'information avec ses ancres suivies : la sienne, et ses renvois (`contredit`, `invalidé … par`) vers la même fiche ; un
 * renvoi vers une ancre absente de la table est retiré (il viserait une information sans rapport de la receveuse).
 */
export function ligneRenumerotee(ligne: LigneDeFait, table: TableDeRenumerotation): LigneDeFait {
	if ('brute' in ligne) return { brute: ligne.brute.map((l) => l.replace(RE_RENVOI, (tout, ancre: string) => (table.has(ancre) ? `^${table.get(ancre)!}` : tout))) };
	const fait: Fait = { ...ligne.fait };
	for (const champ of ['ancre', 'contredit', 'invalidePar'] as const) {
		const ancre = fait[champ];
		if (ancre === undefined) continue;
		const suivie = table.get(ancre);
		if (suivie !== undefined) fait[champ] = suivie;
		else delete fait[champ];
	}
	return { fait };
}

/** Ancre visée par la suite d'un lien (`#^f-X`, alias éventuel après), sinon null. */
export function ancreDeSuite(suite: string): string | null {
	const alias = aliasDeSuite(suite);
	return RE_SUITE_ANCRE.exec(suite.slice(0, suite.length - alias.length))?.[1] ?? null;
}

/**
 * Lien `[[cible…suite]]` vers la fiche `ancienne` (chemin), réécrit vers la fiche `nouvelle` : `#^ancre` suivie par la
 * table, retirée si elle en est absente (comme à la suppression) ; autre `#section` gardée ; texte affiché gardé
 * (`aliasGarde`).
 */
export function lienRenumerote(cible: string, suite: string, ancienne: string, nouvelle: string, table: TableDeRenumerotation): string {
	const alias = aliasDeSuite(suite);
	let section = suite.slice(0, suite.length - alias.length);
	const ancre = RE_SUITE_ANCRE.exec(section);
	if (ancre !== null) section = table.has(ancre[1]!) ? `#^${table.get(ancre[1]!)!}${ancre[2]!}` : '';
	return `[[${sansMd(nouvelle)}${section}${aliasGarde(cible, suite, ancienne)}]]`;
}
