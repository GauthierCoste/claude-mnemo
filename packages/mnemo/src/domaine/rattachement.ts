import { cheminValide } from './chemin.ts';
import { CLE_DOSSIER_PROJET, normaliserDossierProjet } from './elements.ts';
import { CLE_PORTEE, ecrirePortee, GENRES_DE_PORTEE, lirePortee, PORTEE_GLOBALE } from './portee.ts';

/** Le dossier d'un projet, à poser en `dossier_projet`, défini à partir d'un dossier noté (un sous-dossier, souvent). */
export const DEFINITION_DOSSIER_DU_PROJET = "l'ascendant le plus haut de ce chemin qui appartient encore au projet";

/** Ce qu'un lien posé change pour les sessions du dossier. */
export const EFFET_DU_RATTACHEMENT = 'La position et les consignes du projet valent au hook suivant de ses sessions ; ses skills, à leur prochaine session.';

/**
 * Ce que dit Mnemo d'un dossier de projet qu'aucune fiche ne couvre (`dossier_projet`) : `dossier` relatif à la racine Mnemo.
 * La recherche y porte sur toute la mémoire. Les consignes, rappels, épisodes et skills d'un projet ou d'un client y manquent.
 */
export function texteDossierNonRattache(dossier: string): string {
	return `Dossier non rattaché : ${dossier} ; les sessions qui y tournent ne reçoivent ni les consignes, ni les rappels, ni les épisodes, ni les skills d'un projet.`;
}

/** Valeur proposée pour `dossier_projet` : le chemin normalisé (« » la retire), ou le motif du refus. */
export function dossierProjetPropose(brut: unknown): { valeur: string } | { motif: string } {
	if (typeof brut !== 'string') return { motif: `« ${CLE_DOSSIER_PROJET} » doit être un texte : le dossier de projet relatif à la racine du dossier Mnemo (vide pour le retirer).` };
	const net = normaliserDossierProjet(brut);
	if (net === null) return { valeur: '' };
	if (cheminValide(net) !== net) return { motif: `« ${CLE_DOSSIER_PROJET} » : « ${brut} » n'est pas un dossier relatif à la racine du dossier Mnemo (ni chemin absolu, ni « .. »).` };
	return { valeur: net };
}

/** Valeur proposée pour la `portee` d'un lieu : `genre:nom` (« » la retire), ou le motif du refus. */
export function porteeDeLieuProposee(brut: unknown): { valeur: string } | { motif: string } {
	if (brut === '') return { valeur: '' };
	const lue = lirePortee(brut);
	if (lue.genre === 'invalide' || lue.genre === PORTEE_GLOBALE) {
		return { motif: `« ${CLE_PORTEE} » d'un lieu : ${GENRES_DE_PORTEE.map((g) => `« ${g}:nom »`).join(', ')}, ou vide pour la retirer.` };
	}
	return { valeur: ecrirePortee(lue) };
}
