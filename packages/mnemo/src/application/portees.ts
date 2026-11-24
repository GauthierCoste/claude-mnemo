import { PROJET_PAR_DEFAUT } from '@mnemo/commun';
import { GENRES_A_EPISODES, lieuxDe, porteesDesLieux } from '../domaine/portee.ts';
import type { PorteeDeLieu } from '../domaine/portee.ts';
import type { Dependances } from './ports.ts';

/**
 * Portées nommées d'un chemin (position, fiche ou dossier), du plus profond au premier niveau, d'après l'index tel qu'il
 * est : la portée déclarée par la fiche de chaque lieu (clé `portee`), sinon celle de sa place.
 */
export async function porteesDe(dep: Dependances, chemin: string): Promise<PorteeDeLieu[]> {
	const lieux = lieuxDe(chemin);
	const declarees = new Map<string, string | null>();
	for (const lieu of lieux) {
		const element = await dep.index.element(lieu.fiche);
		declarees.set(lieu.fiche, element !== null && element.genre === 'fiche' ? element.portee : null);
	}
	return porteesDesLieux(lieux, (fiche) => declarees.get(fiche) ?? null);
}

/** Projet d'un chemin : le nom de sa portée `projet` ou `client` (dossier d'épisodes) et la position du lieu qui la porte. */
export type ProjetDuLieu = { projet: string; position: string };

/** Projet d'un chemin : sa portée `projet` ou `client` la plus profonde ; null sinon. */
export async function projetDe(dep: Dependances, chemin: string): Promise<ProjetDuLieu | null> {
	const portee = (await porteesDe(dep, chemin)).find((p) => GENRES_A_EPISODES.includes(p.genre));
	return portee === undefined ? null : { projet: portee.nom, position: portee.position };
}

/** Dossier d'épisodes d'une session à cette position : son projet (`projetDe`), sinon le projet par défaut. */
export async function projetDeSession(dep: Dependances, position: string): Promise<string> {
	return (await projetDe(dep, position))?.projet ?? PROJET_PAR_DEFAUT;
}
