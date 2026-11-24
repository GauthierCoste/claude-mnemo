import { cheminValide, dansGit, ficheDeDossier } from '../domaine/chemin.ts';
import { lireFiche } from '../domaine/fiche.ts';
import type { Fiche, TypeFiche } from '../domaine/fiche.ts';
import { nomDeLaFiche } from '../domaine/chemin.ts';
import { CLE_A_TRAITER } from '../domaine/source.ts';
import { CHEMIN_SCHEMA } from './regles-du-coffre.ts';
import type { Dependances } from './ports.ts';
import { sourcesDuCoffre } from './sources.ts';

/** `aTraiter` : fiche source marquée `a_traiter` (en attente de l'archiviste). */
export type Listing = { dossier: string; ficheDossier: Fiche | null; fiches: { chemin: string; titre: string; type: TypeFiche; aTraiter?: true }[]; sousDossiers: string[] };

function lireOuNull(chemin: string, texte: string | null): Fiche | null {
	if (texte === null) return null;
	try {
		return lireFiche(chemin, texte);
	} catch {
		return null;
	}
}

/** Contenu d'un dossier (« » = racine) : sa fiche, ses fiches triées par titre, ses sous-dossiers. */
export async function lister(dep: Dependances, dossier: string): Promise<Listing> {
	const nettoye = dossier.replace(/\\/gu, '/').replace(/\/+$/u, '');
	const valide = nettoye === '' ? '' : cheminValide(nettoye);
	if (valide === null || dansGit(valide)) return { dossier: nettoye, ficheDossier: null, fiches: [], sousDossiers: [] };
	const contenu = await dep.coffre.lister(valide);
	const cheminDossier = valide === '' ? null : ficheDeDossier(valide);
	const fiches: Listing['fiches'] = [];
	let ficheDossier: Fiche | null = null;
	for (const chemin of contenu.fiches) {
		if (chemin === CHEMIN_SCHEMA) continue;
		const texte = await dep.coffre.lire(chemin);
		if (chemin === cheminDossier) {
			ficheDossier = lireOuNull(chemin, texte);
			continue;
		}
		const fiche = lireOuNull(chemin, texte);
		const aTraiter = fiche?.type === 'source' && fiche.donnees[CLE_A_TRAITER] === true ? { aTraiter: true as const } : {};
		fiches.push(fiche === null || fiche.titre === '' ? { chemin, titre: nomDeLaFiche(chemin), type: 'sujet' } : { chemin, titre: fiche.titre, type: fiche.type, ...aTraiter });
	}
	fiches.sort((a, b) => a.titre.localeCompare(b.titre, 'fr'));
	const sousDossiers = contenu.dossiers.map((d) => d.slice(d.lastIndexOf('/') + 1)).sort((a, b) => a.localeCompare(b, 'fr'));
	return { dossier: valide, ficheDossier, fiches, sousDossiers };
}

/** Fiches sources « à traiter » de toute la mémoire, où qu'elles soient rangées, triées par titre (listage sans dossier). */
export async function listerATraiter(dep: Dependances): Promise<Listing> {
	const fiches: Listing['fiches'] = (await sourcesDuCoffre(dep))
		.filter((s) => s.fiche.donnees[CLE_A_TRAITER] === true)
		.map((s) => ({ chemin: s.chemin, titre: s.fiche.titre === '' ? nomDeLaFiche(s.chemin) : s.fiche.titre, type: s.fiche.type, aTraiter: true as const }));
	fiches.sort((a, b) => a.titre.localeCompare(b.titre, 'fr'));
	return { dossier: '', ficheDossier: null, fiches, sousDossiers: [] };
}
