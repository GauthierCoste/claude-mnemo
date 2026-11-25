import type { ActionOutil } from '../regles-verifiees.ts';

/** Agent de code qui fait tourner une session : Claude Code, ou Codex (à venir). */
export type IdMoteur = 'claude-code' | 'codex';
export const IDS_MOTEURS: readonly IdMoteur[] = ['claude-code', 'codex'];
/** Moteur d'une session ou d'un profil qui n'en dit rien (état, profils et hooks d'avant les moteurs). */
export const MOTEUR_PAR_DEFAUT: IdMoteur = 'claude-code';

export const estIdMoteur = (v: unknown): v is IdMoteur => typeof v === 'string' && (IDS_MOTEURS as readonly string[]).includes(v);

/**
 * Outils d'un moteur, tels que ses hooks les nomment : ce que les consignes vérifiées (`chemins_interdits`,
 * `commandes_interdites`) et le contexte servi (`apres_outil`, fiches lues ou écrites) en lisent.
 */
export type OutilsDuMoteur = {
	/** Chemins écrits par l'action, tels que l'outil les donne (relatifs ou absolus) ; null : l'outil n'écrit pas de fichier. */
	cheminsEcrits(action: ActionOutil): string[] | null;
	/** Ligne de commande de l'outil de commande (« » s'il n'en porte pas) ; null : un autre outil. */
	commande(action: ActionOutil): string | null;
	/** Préfixe des outils du serveur MCP `mnemo` chez ce moteur. */
	prefixeMcp: string;
	/** Motif (`matcher`) des outils après lesquels `apres_outil` est appelé : un fichier, une fiche lus ou écrits. */
	motifApresOutil: string;
};

/**
 * Touches que le pilote envoie au terminal du moteur : `echap` ferme un dialogue (permission), suivi de `pauseApresEchapMs`
 * avant toute autre touche ; `attenteApresEchapMs` : attente, au plus, de l'arrêt qui suit ; `arret` (puis `entree`) termine
 * la session.
 */
export type TouchesDuMoteur = { echap: string; pauseApresEchapMs: number; attenteApresEchapMs: number; arret: string; entree: string };

/**
 * Remplissage de la fenêtre de contexte d'une session, lu par le moteur (télémétrie) : tokens occupés et maximum ;
 * `avantResume` : le maximum est le seuil de résumé automatique du moteur, non la taille de la fenêtre.
 */
export type FenetreDeContexte = { utilises: number; max: number; avantResume?: true };
