// Aides à la répartition d'une source : les fiches qu'un document nomme, et celles qui citent une source une fois traitée.
import { fichesNommees } from '../domaine/fiches-nommees.ts';
import { TYPES_NON_PROPOSABLES } from '../domaine/perimetre.ts';
import type { BilanDeRepartition } from './commun.ts';
import { liensDeLaMemoire } from './liens.ts';
import type { Dependances } from './ports.ts';

/** Fiches nommées rendues au plus par `extraire_source`. */
export const MENTIONNEES_MAX = 30;
/** Texte lu pour chercher les noms : le début d'un très gros document suffit à dire qui il concerne. */
export const TEXTE_MENTIONS_MAX = 2_000_000;
/** Une source d'au moins ce nombre de passages qui ne touche qu'une fiche est signalée. */
export const PASSAGES_SOURCE_RICHE = 8;

/** Types qui ne reçoivent pas les informations d'une source : ni destinations à suggérer, ni fiches qui « citent » la source. */
const HORS_REPARTITION: readonly string[] = [...TYPES_NON_PROPOSABLES];

/**
 * Fiches (personnes, organisations, projets, notions…) dont le titre ou un alias apparaît dans `texte`, en mots entiers,
 * dans l'ordre de première apparition ; ni sources, ni dossiers, ni consignes, profils ou épisodes. Index indisponible → [].
 */
export async function fichesMentionnees(dep: Dependances, texte: string): Promise<string[]> {
	try {
		const [fiches, titres] = await Promise.all([dep.index.elements({ genres: ['fiche'], typesFicheExclus: [...HORS_REPARTITION] }), dep.index.titres()]);
		const retenues = new Set(fiches.map((f) => f.chemin));
		return fichesNommees(texte.slice(0, TEXTE_MENTIONS_MAX), titres.filter((t) => retenues.has(t.chemin))).slice(0, MENTIONNEES_MAX);
	} catch {
		return [];
	}
}

/**
 * Bilan d'une source traitée : `citeePar`, les fiches qui la citent (informations, relations, sections), hors sources,
 * dossiers, consignes, profils et épisodes ; `riche` : ses passages atteignent `PASSAGES_SOURCE_RICHE`. Null si `fiche`
 * n'est pas une source indexée ou si l'index est indisponible.
 */
export async function bilanDeRepartition(dep: Dependances, fiche: string): Promise<BilanDeRepartition | null> {
	try {
		const etat = (await dep.index.sources()).find((s) => s.fiche === fiche);
		if (etat === undefined) return null;
		const entrants = [...new Set((await (await liensDeLaMemoire(dep)).entrants(fiche)).map((l) => l.de))];
		const types = new Map((await dep.index.elements({ genres: ['fiche'], chemins: entrants })).map((e) => [e.chemin, e.typeFiche]));
		const citeePar = entrants.filter((c) => types.has(c) && !HORS_REPARTITION.includes(types.get(c)!));
		return { citeePar, passages: etat.passages, riche: etat.passages >= PASSAGES_SOURCE_RICHE };
	} catch {
		return null;
	}
}
