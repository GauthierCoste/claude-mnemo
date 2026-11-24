import { cleDeCasse } from '../../domaine/chemin.ts';
import type { Fait } from '../../domaine/fait.ts';
import { typeSourcePersonnel } from '../../domaine/regles.ts';
import type { TypeSource } from '../../domaine/regles.ts';
import { lienDeMention, RE_LIEN_SOURCE, typeDeFicheSource } from '../commun.ts';
import type { Dependances } from '../ports.ts';

/**
 * Une source d'une information : sa mention (`src:` ou corroboration), sa clé d'indépendance (deux sources de même clé sont
 * la même référence) et son type.
 */
export type SourceDuFait = { mention: string; cle: string; type: TypeSource };

/** Fiche désignée par la cible d'un lien (chemin, nom, titre, alias), ou null : `MemoireLue.designee`. */
export type Designee = (cible: string) => string | null;

/** Fiche visée par le premier lien d'une mention : résolue comme le graphe (`designee`), sinon par son chemin écrit. */
function ficheDeLaMention(mention: string, designee?: Designee): string | null {
	const lien = RE_LIEN_SOURCE.exec(mention);
	if (lien === null) return null;
	const resolue = designee?.(lien[1]!.split(/[#^|]/u)[0]!.trim()) ?? null;
	return resolue ?? lienDeMention(mention);
}

/**
 * Clé d'indépendance d'une mention de source : la fiche visée par son lien, résolue (`[[sources/a]]`, `[[sources/a.md]]`,
 * `[[sources/a|A]]`, `[[Titre de a]]` et `[[sources/a]] p. 3` sont la même référence : le même document), casse ignorée ;
 * une source personnelle (`utilisateur …`, `session …`, `deduction …`) ou sans lien : la mention elle-même, blancs réduits.
 */
export function cleDeSource(mention: string, designee?: Designee): string {
	const fiche = typeSourcePersonnel(mention) === null ? ficheDeLaMention(mention, designee) : null;
	return fiche !== null ? `[[${cleDeCasse(fiche)}]]` : mention.trim().replace(/\s+/gu, ' ');
}

/** Type d'une mention : préfixe personnel (`utilisateur …`, `session …`, `deduction …`), sinon `type_source` de la fiche liée, sinon « inconnue ». */
export async function typeDeSource(dep: Pick<Dependances, 'coffre'>, mention: string, designee?: Designee, cache?: Map<string, TypeSource>): Promise<TypeSource> {
	const personnel = typeSourcePersonnel(mention);
	if (personnel !== null) return personnel;
	const fiche = ficheDeLaMention(mention, designee);
	return fiche === null ? 'inconnue' : typeDeFicheSource(dep, fiche, cache);
}

/** Les sources d'une information, dans l'ordre de la fiche : la première (`src:`), puis chaque corroboration. */
export async function sourcesDuFait(dep: Pick<Dependances, 'coffre'>, fait: Fait, designee?: Designee, cache?: Map<string, TypeSource>): Promise<SourceDuFait[]> {
	const mentions = [...(fait.source === undefined ? [] : [fait.source]), ...(fait.corroborations ?? []).map((c) => c.source)];
	const sources: SourceDuFait[] = [];
	for (const mention of mentions) sources.push({ mention, cle: cleDeSource(mention, designee), type: await typeDeSource(dep, mention, designee, cache) });
	return sources;
}
