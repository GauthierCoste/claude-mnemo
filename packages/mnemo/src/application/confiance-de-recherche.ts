import type { ElementIndexe } from '../domaine/elements.ts';
import { estContenuDeDocument, normaliserCible } from '../domaine/elements.ts';
import { analyserFiche } from '../domaine/fiche.ts';
import { CLE_ORIGINE, PREFIXE_ORIGINE_CLAUDE_CODE } from '../domaine/origines-importees.ts';
import type { Regles } from '../domaine/regles.ts';
import type { Dependances } from './ports.ts';

const RE_PREMIER_LIEN = /\[\[([^\]]+)\]\]/u;

/** Résolveur des liens `[[…]]` (chemin, nom, titre, alias), chargé au premier besoin. */
export type ResoudreLien = () => Promise<(vers: string) => string | null>;

/** Cible (chemin avec `.md`) du premier lien `[[…]]` de la mention de source, telle qu'écrite ; null sans lien. */
export const cibleDuLien = (source: string | null): string | null => {
	const cible = source === null ? undefined : RE_PREMIER_LIEN.exec(source)?.[1];
	return cible === undefined ? null : normaliserCible(cible);
};

/** Fiche que désigne le premier lien `[[…]]` de la mention de source (par chemin, nom, titre ou alias) ; null : aucune. */
export async function ficheCitee(source: string | null, resoudre: ResoudreLien): Promise<string | null> {
	const cible = cibleDuLien(source);
	return cible === null ? null : (await resoudre())(cible);
}

/** Texte de la fiche, lu une fois par recherche (`fiches`) ; null si elle est absente ou illisible. */
function texteDeFiche(dep: Dependances, chemin: string, fiches: Map<string, Promise<string | null>>): Promise<string | null> {
	let texte = fiches.get(chemin);
	if (texte === undefined) {
		texte = dep.coffre.lire(chemin).catch(() => null);
		fiches.set(chemin, texte);
	}
	return texte;
}

/**
 * Vrai si la mention de source est un lien `[[…]]` (par chemin, nom, titre ou alias) vers une note importée de Claude
 * Code : une fiche dont la propriété `origine` commence par `claude-code/`, où qu'elle soit rangée.
 */
export async function citeUneNoteDeClaudeCode(dep: Dependances, source: string | null, resoudre: ResoudreLien, fiches: Map<string, Promise<string | null>>): Promise<boolean> {
	const fiche = await ficheCitee(source, resoudre);
	if (fiche === null) return false;
	const texte = await texteDeFiche(dep, fiche, fiches);
	if (texte === null) return false;
	const origine = analyserFiche(fiche, texte).fiche.donnees[CLE_ORIGINE];
	return typeof origine === 'string' && origine.startsWith(`${PREFIXE_ORIGINE_CLAUDE_CODE}/`);
}

/**
 * Confiance d'un élément pour la note de recherche (de 0 à 1) :
 * - fiche `source` et ses passages : la fiabilité de son type de source (`type_source`, « inconnue » à défaut) ;
 * - fait `declare` qui porte une citation et dont la source est un lien vers une note importée de Claude Code (fiche
 *   d'`origine` `claude-code/…`, désignée par chemin, nom, titre ou alias, où qu'elle soit rangée) : la fiabilité `utilisateur`. La note
 *   importée n'est que le support de la parole de l'utilisateur, que la citation rapporte ; sa fiabilité de « note » ne la
 *   diminue pas ;
 * - sinon la confiance de l'élément, 1 à défaut.
 * `fiches` : textes des fiches déjà lus (un fait à vérifier fait relire sa fiche une fois par recherche).
 */
export async function confianceDeRecherche(
	dep: Dependances,
	e: ElementIndexe,
	regles: Regles,
	fiches: Map<string, Promise<string | null>>,
	resoudre: ResoudreLien,
): Promise<number> {
	if (estContenuDeDocument(e)) return regles.fiabilites[e.typeSource ?? 'inconnue'];
	if (e.genre === 'fait' && cibleDuLien(e.source) !== null && (await estParoleCitee(dep, e, fiches, resoudre))) return regles.fiabilites.utilisateur;
	return e.confiance ?? 1;
}

/** Le fait (relu dans sa fiche, par son ancre) est `declare`, porte une citation et cite une note de Claude Code. */
async function estParoleCitee(dep: Dependances, e: ElementIndexe, fiches: Map<string, Promise<string | null>>, resoudre: ResoudreLien): Promise<boolean> {
	const ancre = /#\^(f-\d+)$/u.exec(e.id)?.[1];
	if (ancre === undefined) return false;
	const brut = await texteDeFiche(dep, e.chemin, fiches);
	if (brut === null) return false;
	for (const ligne of analyserFiche(e.chemin, brut).fiche.faits) {
		if ('fait' in ligne && ligne.fait.ancre === ancre) {
			return ligne.fait.nature === 'declare' && ligne.fait.citation !== undefined && (await citeUneNoteDeClaudeCode(dep, ligne.fait.source ?? null, resoudre, fiches));
		}
	}
	return false;
}
