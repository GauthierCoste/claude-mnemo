import { A_TRAITER_MAX, DOCUMENTS_MAX } from '@mnemo/commun';
import { nomDeLaFiche } from '../domaine/chemin.ts';
import { CLE_A_TRAITER } from '../domaine/source.ts';
import type { Dependances } from './ports.ts';
import { sourcesDuCoffre } from './sources.ts';

/**
 * Un document référencé : fiche `source` (`chemin`, `titre`), son fichier (`document`, null pour une note importée sans
 * fichier), la date de la fiche, et son marqueur « à traiter ».
 */
export type DocumentReference = { chemin: string; titre: string; document: string | null; date: string; aTraiter: boolean };

/** Bornes des listes de `documentsDeLaMemoire` : celles de `@mnemo/commun`, ou aucune (`tout`). */
export const BORNES_DOCUMENTS = { max: DOCUMENTS_MAX, maxATraiter: A_TRAITER_MAX } as const;
export const SANS_BORNE = { max: Infinity, maxATraiter: Infinity } as const;

/**
 * Fiches `source`, où qu'elles soient rangées, plus récentes d'abord (date de la fiche, puis chemin) : `recents`, `max` au plus,
 * et `aTraiter`, celles marquées « à traiter » (`maxATraiter` au plus) ; `total`, `totalATraiter` : combien il y en a,
 * listées ou non. Une fiche illisible est ignorée.
 */
export async function documentsDeLaMemoire(
	dep: Dependances,
	bornes: { max: number; maxATraiter: number },
): Promise<{ recents: DocumentReference[]; aTraiter: DocumentReference[]; total: number; totalATraiter: number }> {
	const documents: DocumentReference[] = (await sourcesDuCoffre(dep)).map(({ chemin, fiche, d }) => ({
		chemin,
		titre: d.titre || nomDeLaFiche(chemin),
		document: d.document,
		date: fiche.updated,
		aTraiter: fiche.donnees[CLE_A_TRAITER] === true,
	}));
	documents.sort((a, b) => b.date.localeCompare(a.date) || a.chemin.localeCompare(b.chemin));
	const aTraiter = documents.filter((d) => d.aTraiter);
	return { recents: documents.slice(0, bornes.max), aTraiter: aTraiter.slice(0, bornes.maxATraiter), total: documents.length, totalATraiter: aTraiter.length };
}
