// Liens d'une fiche, résolus comme le graphe les résout (chemin, nom unique, titre, alias) : vue d'une fiche, outil `voisins`.
import { nomDeLaFiche } from '../domaine/chemin.ts';
import { liensDeLaMemoire } from './liens.ts';
import type { Dependances } from './ports.ts';
import { SANS_EXTRACTION, synchroniser } from './synchroniser.ts';

/** `ecrit` : la cible telle qu'écrite (sans `.md`) ; `chemin` : la fiche visée, null si aucune (absente, ambiguë, hors mémoire). */
export type LienSortant = { ecrit: string; chemin: string | null; verbe: string | null };
export type LienEntrant = { chemin: string; titre: string; verbe: string | null };
export type LiensDeFiche = { sortants: LienSortant[]; entrants: LienEntrant[] };

/** Liens de la fiche d'après l'index (à synchroniser avant) : entrants = liens d'autres fiches qui se résolvent vers elle. */
export async function liensDeLaFiche(dep: Dependances, chemin: string): Promise<LiensDeFiche> {
	const liens = await liensDeLaMemoire(dep);
	const titreDe = new Map(liens.titres.map((t) => [t.chemin, t.titre]));
	return {
		sortants: (await liens.sortants(chemin)).map((l) => ({ ecrit: l.vers.replace(/\.md$/u, ''), chemin: l.cible, verbe: l.verbe })),
		entrants: (await liens.entrants(chemin)).map((l) => ({ chemin: l.de, titre: titreDe.get(l.de) ?? nomDeLaFiche(l.de), verbe: l.verbe })),
	};
}

/** Le texte de la fiche et ses liens, l'index d'abord rattrapé (sans extraction de documents) ; null si elle n'existe pas. */
export async function lireFicheEtLiens(dep: Dependances, chemin: string): Promise<{ brut: string; liens: LiensDeFiche } | null> {
	await synchroniser(dep, SANS_EXTRACTION);
	const brut = await dep.coffre.lire(chemin);
	if (brut === null) return null;
	return { brut, liens: await liensDeLaFiche(dep, chemin) };
}
