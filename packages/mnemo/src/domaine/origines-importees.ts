// Origines d'import d'une fiche : d'où viennent les notes de Claude Code qu'elle porte, et l'empreinte de leur contenu. Pur.
//
// Une fiche importée a son `origine` et l'`empreinte_origine` de sa note ; `origines` liste toutes les origines dont elle
// tient le contenu (la sienne en tête) ; `empreintes_origines` note l'empreinte d'une origine versée par l'entretien (fusion,
// suppression avec redirection), dont le contenu n'est pas forcément celui de la fiche. L'import tient une origine notée
// pour connue tant que sa note n'a pas changé : le ménage de l'archiviste n'est pas défait au réimport.
import type { Fiche } from './fiche.ts';

/** Début de toute origine importée de Claude Code (notes, CLAUDE.md global, instructions de projet). */
export const PREFIXE_ORIGINE_CLAUDE_CODE = 'claude-code';
export const CLE_ORIGINE = 'origine';
export const CLE_EMPREINTE = 'empreinte_origine';
export const CLE_ORIGINES = 'origines';
export const CLE_EMPREINTES_ORIGINES = 'empreintes_origines';
/** Propriétés d'origine d'import : l'entretien les verse par `verserOrigines`, jamais telles quelles. */
export const CLES_D_ORIGINE: readonly string[] = [CLE_ORIGINE, CLE_EMPREINTE, CLE_ORIGINES, CLE_EMPREINTES_ORIGINES];

/** Origine d'une note de mémoire de Claude Code ou de son CLAUDE.md global (pas d'une instruction de projet). */
export const estOrigineDeNote = (origine: string): boolean =>
	origine === `${PREFIXE_ORIGINE_CLAUDE_CODE}/CLAUDE.md` || /^claude-code\/.+\/memory\/.+\.md$/u.test(origine);

const texte = (valeur: unknown): string | null => (typeof valeur === 'string' ? valeur : null);

/** Origine propre de la fiche, si c'est celle d'une note ; null sinon. */
function originePropre(fiche: Fiche): string | null {
	const origine = texte(fiche.donnees[CLE_ORIGINE]);
	return origine !== null && estOrigineDeNote(origine) ? origine : null;
}

/** Origines regroupées sur la fiche (`origines`, chaînes seules) ; vide si elle n'en a pas. */
export const originesDe = (fiche: Fiche): string[] => {
	const valeur = fiche.donnees[CLE_ORIGINES];
	return Array.isArray(valeur) ? valeur.filter((o): o is string => typeof o === 'string') : [];
};

/** Empreintes notées par origine (`empreintes_origines`, chaînes seules). */
export function empreintesNotees(fiche: Fiche): Map<string, string> {
	const valeur = fiche.donnees[CLE_EMPREINTES_ORIGINES];
	const notees = new Map<string, string>();
	if (valeur === null || typeof valeur !== 'object' || Array.isArray(valeur)) return notees;
	for (const [origine, empreinte] of Object.entries(valeur)) if (typeof empreinte === 'string') notees.set(origine, empreinte);
	return notees;
}

/**
 * Origines de note que la fiche porte, avec l'empreinte de leur contenu : la sienne (`empreinte_origine`), celles de
 * `origines` (empreinte notée, sinon la sienne : même contenu regroupé) et celles de `empreintes_origines`. Une origine
 * sans empreinte connue n'est pas rendue.
 */
export function originesImportees(fiche: Fiche): Map<string, string> {
	const propre = originePropre(fiche);
	const empreinte = texte(fiche.donnees[CLE_EMPREINTE]);
	const notees = empreintesNotees(fiche);
	const toutes = new Map<string, string>();
	if (propre !== null && empreinte !== null) toutes.set(propre, empreinte);
	for (const origine of originesDe(fiche)) {
		const h = notees.get(origine) ?? empreinte;
		if (estOrigineDeNote(origine) && h !== null && !toutes.has(origine)) toutes.set(origine, h);
	}
	for (const [origine, h] of notees) if (estOrigineDeNote(origine) && !toutes.has(origine)) toutes.set(origine, h);
	return toutes;
}

/**
 * Verse dans `fiche` les origines `versees` (origine → empreinte) qu'elle ne porte pas encore : ajoutées à `origines`
 * (précédées de sa propre origine de note, s'il y en a une) avec leur empreinte dans `empreintes_origines`. Rend les
 * origines ajoutées, dans l'ordre reçu.
 */
export function verserOrigines(fiche: Fiche, versees: ReadonlyMap<string, string>): string[] {
	const propre = originePropre(fiche);
	const connues = originesDe(fiche);
	const liste = connues.length > 0 ? [...connues] : propre === null ? [] : [propre];
	const notees = empreintesNotees(fiche);
	const ajoutees: string[] = [];
	for (const [origine, empreinte] of versees) {
		if (origine === propre || liste.includes(origine) || notees.has(origine)) continue;
		liste.push(origine);
		notees.set(origine, empreinte);
		ajoutees.push(origine);
	}
	if (ajoutees.length === 0) return [];
	fiche.donnees[CLE_ORIGINES] = liste;
	fiche.donnees[CLE_EMPREINTES_ORIGINES] = Object.fromEntries(notees);
	return ajoutees;
}

/**
 * Retire `origine` des origines de la fiche et de ses empreintes notées ; `origines` disparaît s'il n'y reste que la
 * propre origine de la fiche, `empreintes_origines` s'il est vide. Vrai si la fiche a changé.
 */
export function retirerOrigine(fiche: Fiche, origine: string): boolean {
	const avant = originesDe(fiche);
	const notees = empreintesNotees(fiche);
	const restantes = avant.filter((o) => o !== origine);
	if (restantes.length === avant.length && !notees.has(origine)) return false;
	notees.delete(origine);
	const propre = texte(fiche.donnees[CLE_ORIGINE]);
	if (restantes.some((o) => o !== propre)) fiche.donnees[CLE_ORIGINES] = restantes;
	else delete fiche.donnees[CLE_ORIGINES];
	if (notees.size > 0) fiche.donnees[CLE_EMPREINTES_ORIGINES] = Object.fromEntries(notees);
	else delete fiche.donnees[CLE_EMPREINTES_ORIGINES];
	return true;
}
