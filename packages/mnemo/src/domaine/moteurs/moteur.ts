import type { ActionOutil } from '../regles-verifiees.ts';

export { estIdMoteur, IDS_MOTEURS, MOTEUR_PAR_DEFAUT } from '@mnemo/commun';
export type { IdMoteur } from '@mnemo/commun';

/** Une commande que l'outil fait exécuter sans qu'elle se lise (saisie envoyée à un processus déjà lancé). */
export type CommandeIllisible = { illisible: true };

/**
 * Outils d'un moteur, tels que ses hooks les nomment : ce que les consignes vérifiées (`chemins_interdits`,
 * `commandes_interdites`) et le contexte servi (`apres_outil`, fiches lues ou écrites) en lisent.
 */
export type OutilsDuMoteur = {
	/**
	 * Chemins écrits par l'action, tels que l'outil les donne (relatifs ou absolus) ; null : l'outil n'écrit pas de fichier ;
	 * `illisible` : il en écrit, mais ses chemins ne se lisent pas (refus s'il y a des chemins interdits).
	 */
	cheminsEcrits(action: ActionOutil): string[] | null | 'illisible';
	/**
	 * Ligne de commande de l'outil de commande (« » s'il n'en porte pas) ; null : un autre outil ; `{ illisible: true }` : il
	 * en fait exécuter une, mais elle ne se lit pas (refus s'il y a des commandes interdites).
	 */
	commande(action: ActionOutil): string | null | CommandeIllisible;
	/** Préfixe des outils du serveur MCP `mnemo` chez ce moteur. */
	prefixeMcp: string;
	/** Motif (`matcher`) des outils après lesquels `apres_outil` est appelé : un fichier, une fiche lus ou écrits. */
	motifApresOutil: string;
};

/**
 * Touches que le pilote envoie au terminal du moteur : `echap` ferme un dialogue (permission), suivi de `pauseApresEchapMs`
 * avant toute autre touche ; `attenteApresEchapMs` : attente, au plus, de l'arrêt qui suit ; `arret` (puis `entree`) termine
 * la session ; `pauseAvantEntreeMs` : pause entre une ligne tapée et son Entrée (0 : écrites ensemble ; Codex prend une
 * rafale de caractères pour un collage, et l'Entrée qui la suit aussitôt n'envoie pas la ligne).
 */
export type TouchesDuMoteur = { echap: string; pauseApresEchapMs: number; attenteApresEchapMs: number; arret: string; entree: string; pauseAvantEntreeMs: number };

/**
 * Remplissage de la fenêtre de contexte d'une session, lu par le moteur (télémétrie) : tokens occupés et maximum ;
 * `avantResume` : le maximum est le seuil de résumé automatique du moteur, non la taille de la fenêtre.
 */
export type FenetreDeContexte = { utilises: number; max: number; avantResume?: true };
