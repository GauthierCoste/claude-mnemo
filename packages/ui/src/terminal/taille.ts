/**
 * Taille d'un terminal à envoyer au service : jamais une cellule cachée (taille nulle), jamais sous 20×5, jamais deux
 * fois la même taille d'affilée (pas d'oscillation du pty).
 */

export type Taille = { colonnes: number; lignes: number };

export const TAILLE_MIN: Taille = { colonnes: 20, lignes: 5 };
/** Calme demandé après le dernier changement de taille du conteneur avant d'ajuster (animation de la grille : 340 ms). */
export const ATTENTE_REDIMENSION_MS = 120;

export function tailleAEnvoyer(proposee: Taille | null, derniere: Taille | null): Taille | null {
	if (!proposee) return null;
	if (proposee.colonnes < TAILLE_MIN.colonnes || proposee.lignes < TAILLE_MIN.lignes) return null;
	if (derniere && derniere.colonnes === proposee.colonnes && derniere.lignes === proposee.lignes) return null;
	return { colonnes: proposee.colonnes, lignes: proposee.lignes };
}
