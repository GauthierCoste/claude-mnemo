import { lireFiche } from '../domaine/fiche.ts';
import type { Fiche } from '../domaine/fiche.ts';
import { descripteurDeSource } from '../domaine/source.ts';
import type { DescripteurSource } from '../domaine/source.ts';
import type { Dependances } from './ports.ts';
import { SANS_EXTRACTION, synchroniser } from './synchroniser.ts';

export type SourceLue = { chemin: string; fiche: Fiche; d: DescripteurSource };

/**
 * Fiches de type `source` de la mémoire, où qu'elles soient rangées, d'après l'index synchronisé sans extraction, relues
 * dans le coffre, triées par chemin ; une fiche illisible est ignorée.
 */
export async function sourcesDuCoffre(dep: Dependances): Promise<SourceLue[]> {
	try {
		await synchroniser(dep, SANS_EXTRACTION);
	} catch {
		// une panne de l'index ne bloque pas l'énumération (l'index tel qu'il est) ; amorce et dépôt la rapportent par leur synchronisation
	}
	const chemins = (await dep.index.elements({ genres: ['fiche'], typesFiche: ['source'] })).map((e) => e.chemin).sort();
	const sortie: SourceLue[] = [];
	for (const chemin of chemins) {
		const lue = await sourceLue(dep, chemin);
		if (lue !== null) sortie.push(lue);
	}
	return sortie;
}

/** La fiche `chemin` lue avec son descripteur, ou null si elle est absente, illisible ou n'est pas une fiche `source`. */
export async function sourceLue(dep: Dependances, chemin: string): Promise<SourceLue | null> {
	const texte = await dep.coffre.lire(chemin);
	if (texte === null) return null;
	try {
		const fiche = lireFiche(chemin, texte);
		const d = descripteurDeSource(fiche);
		return d === null ? null : { chemin, fiche, d };
	} catch {
		return null;
	}
}

/** Vrai pour la fiche du fichier entier (ni un fil d'un fichier, ni une note sans fichier). */
export const estFichierEntier = (d: DescripteurSource): d is DescripteurSource & { document: string } => d.document !== null && d.fil === null;
