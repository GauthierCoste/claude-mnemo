// Réglages du groupe « Mémoire » : les règles de SCHEMA.md, lues et modifiées pour Réglages › Mémoire (un commit par écriture).
import { modifierSchema, valeursMemoire } from '../domaine/reglages-memoire.ts';
import { ecrireEtCommiter, sousVerrou } from './commun.ts';
import type { Dependances } from './ports.ts';
import { CHEMIN_SCHEMA, chargerRegles } from './regles-du-coffre.ts';

/** Valeurs actuelles des règles et anomalies de lecture de SCHEMA.md. */
export async function lireReglagesMemoire(dep: Dependances): Promise<{ valeurs: Record<string, number>; anomalies: string[] }> {
	const regles = await chargerRegles(dep);
	return { valeurs: valeursMemoire(regles), anomalies: regles.anomalies };
}

/**
 * Modifie les règles de SCHEMA.md (`{ "memoire.<nom>": valeur | null }`) ; tout ou rien, refusé avec un motif par erreur.
 * Un commit `mnemo: reglages SCHEMA.md` ; aucun si rien ne change.
 */
export async function modifierReglagesMemoire(dep: Dependances, valeurs: Record<string, unknown>): Promise<{ ok: true; commit: string | null } | { ok: false; motifs: string[] }> {
	return sousVerrou(dep, async () => {
		const avant = (await dep.coffre.lire(CHEMIN_SCHEMA)) ?? '';
		const r = modifierSchema(avant, valeurs);
		if (!r.ok) return r;
		if (r.texte === avant) return { ok: true, commit: null };
		return { ok: true, commit: await ecrireEtCommiter(dep, [{ chemin: CHEMIN_SCHEMA, texte: r.texte }], `mnemo: reglages ${CHEMIN_SCHEMA}`) };
	});
}
