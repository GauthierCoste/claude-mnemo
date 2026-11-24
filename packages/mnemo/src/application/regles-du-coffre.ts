import { lireFiche } from '../domaine/fiche.ts';
import { lireRegles } from '../domaine/regles.ts';
import type { Regles } from '../domaine/regles.ts';
import type { Dependances } from './ports.ts';

export const CHEMIN_SCHEMA = 'SCHEMA.md';

/** Règles du frontmatter de SCHEMA.md ; défauts si le fichier est absent, défauts et anomalie s'il est illisible. */
export async function chargerRegles(dep: Dependances): Promise<Regles> {
	const texte = await dep.coffre.lire(CHEMIN_SCHEMA);
	if (texte === null) return lireRegles({});
	try {
		return lireRegles(lireFiche(CHEMIN_SCHEMA, texte).donnees);
	} catch (erreur) {
		const regles = lireRegles({});
		regles.anomalies.push(`${erreur instanceof Error ? erreur.message : String(erreur)} ; règles par défaut appliquées.`);
		return regles;
	}
}
