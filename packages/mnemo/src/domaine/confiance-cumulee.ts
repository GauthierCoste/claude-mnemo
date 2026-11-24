// Confiance d'une information corroborée : ses sources cumulées. Pur, sans module `node:`.
import type { Fait } from './fait.ts';
import { confiance } from './regles.ts';
import type { Regles, TypeSource } from './regles.ts';

/** Une source de l'information : sa référence (lien déjà résolu par l'appelant), sa confiance seule (0 à 1), son type. */
export type PartDeConfiance = { ref: string; confiance: number; type: string };

/**
 * Plafond de la confiance cumulée, sauf si l'une des sources est de type `utilisateur` ou `contrat`, ou dépasse déjà seule
 * ce plafond (une source forte est là) : plafond 1.
 */
export const PLAFOND_CONFIANCE_CUMULEE = 0.9;
/** Types de source qui lèvent le plafond de la confiance cumulée. */
export const TYPES_SANS_PLAFOND: readonly string[] = ['utilisateur', 'contrat'];

const borner = (c: number): number => Math.min(1, Math.max(0, c));
const sansPlafond = (confiance: number, type: string): boolean => TYPES_SANS_PLAFOND.includes(type) || confiance > PLAFOND_CONFIANCE_CUMULEE;

/**
 * Confiance (0 à 1) d'une information dont on connaît toutes les sources : `1 − Π(1 − cᵢ)` sur les sources indépendantes,
 * c'est-à-dire de références différentes (une référence répétée compte une fois, avec sa meilleure confiance), plafonnée
 * à 0,9 sauf si l'une des sources est de type `utilisateur` ou `contrat` ou dépasse seule 0,9 (plafond 1). `cᵢ` est la
 * confiance que la source seule donnerait (`confiance` de `regles.ts` : fiabilité du type × poids de la nature, ramenée
 * entre 0 et 1). Jamais sous la meilleure source seule : une source seule garde sa confiance d'aujourd'hui. 0 sans source.
 * Même règle que `ajouterSource` appliquée source par source (avec `dejaSansPlafond` dès qu'une source `utilisateur` ou
 * `contrat` est présente), sauf un écart : si le plafond de 0,9 a coupé le cumul à une étape où aucune source sans plafond
 * n'était encore là, la part coupée est perdue pour les ajouts suivants (la fiche ne garde que la confiance affichée).
 */
export function confianceCumulee(parts: readonly PartDeConfiance[]): number {
	const parRef = new Map<string, number>();
	for (const { ref, confiance } of parts) parRef.set(ref, Math.max(parRef.get(ref) ?? 0, borner(confiance)));
	if (parRef.size === 0) return 0;
	let reste = 1;
	for (const c of parRef.values()) reste *= 1 - c;
	const plafond = parts.some((p) => sansPlafond(borner(p.confiance), p.type)) ? 1 : PLAFOND_CONFIANCE_CUMULEE;
	return Math.min(1 - reste, plafond);
}

/**
 * Confiance (0 à 1) d'une information à laquelle on ajoute une source, depuis sa confiance affichée (la fiche ne garde ni
 * le type ni la confiance de chaque source) : `1 − (1 − actuelle)(1 − nouvelle)`, plafonnée à 0,9 sauf (plafond 1) si
 * `dejaSansPlafond` (une source `utilisateur` ou `contrat` est déjà sur l'information : l'appelant le déduit de ses
 * références), si `actuelle` dépasse 0,9, ou si la nouvelle source est `utilisateur` ou `contrat` ou dépasse seule 0,9.
 * Jamais sous `actuelle` ni sous la nouvelle source seule. L'appelant refuse une référence déjà présente : chaque ajout
 * est indépendant. Écart restant avec `confianceCumulee` : voir sa documentation.
 */
export function ajouterSource(actuelle: number, nouvelle: { confiance: number; type: string }, dejaSansPlafond = false): number {
	const a = borner(actuelle);
	const n = borner(nouvelle.confiance);
	const plafond = dejaSansPlafond || a > PLAFOND_CONFIANCE_CUMULEE || sansPlafond(n, nouvelle.type) ? 1 : PLAFOND_CONFIANCE_CUMULEE;
	return Math.min(1 - (1 - a) * (1 - n), plafond);
}

/**
 * Confiance (pourcentage entier) d'une information telle qu'elle est : celle qui est écrite ; à défaut, celle que sa
 * première source donnerait seule (« inconnue » sans source). Nature absente : `declare`. `sources` : ses sources, dans
 * l'ordre de la fiche, avec leur type.
 */
export function confianceActuelle(regles: Regles, fait: Fait, sources: readonly { type: TypeSource }[]): number {
	return fait.confiance ?? confiance(regles, sources[0]?.type ?? 'inconnue', fait.nature ?? 'declare');
}

/**
 * Confiance (pourcentage entier) de l'information `fait`, de sources `sources`, une fois une source de type `type` ajoutée
 * (`ajouterSource`) : depuis `confianceActuelle` ; la nouvelle source compte avec la nature de l'information ; plafond
 * levé si l'une des sources déjà là est `utilisateur` ou `contrat`. L'appelant a refusé une référence déjà présente.
 */
export function confianceAvecSource(regles: Regles, fait: Fait, sources: readonly { type: TypeSource }[], type: TypeSource): number {
	const actuelle = confianceActuelle(regles, fait, sources);
	const dejaSansPlafond = sources.some((s) => TYPES_SANS_PLAFOND.includes(s.type));
	const nouvelle = confiance(regles, type, fait.nature ?? 'declare') / 100;
	return Math.round(100 * ajouterSource(actuelle / 100, { confiance: nouvelle, type }, dejaSansPlafond));
}
