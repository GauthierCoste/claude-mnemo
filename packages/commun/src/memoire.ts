/**
 * Où Mnemo écrit une fiche née sans chemin. L'arborescence de la mémoire est libre : l'archiviste peut ranger ces fiches
 * ailleurs, et aucun code ne les relit à ces chemins (types, portées et données les désignent).
 */
export const EMPLACEMENTS_PAR_DEFAUT = {
	consignes: 'consignes',
	episodes: 'episodes',
	sources: 'sources',
	claudeCode: 'sources/claude-code',
} as const;

/** Dossiers à chemin fixe : les profils de Mnemo et les skills au format de Claude Code (`skills/<nom>/SKILL.md`). */
export const DOSSIERS_FIXES = {
	profils: 'profils',
	skills: 'skills',
} as const;

/** Projet d'une session hors projet et hors client (dossier d'épisodes par défaut `episodes/divers`). */
export const PROJET_PAR_DEFAUT = 'divers';

/** Profil de la session qui range la mémoire : un seul à la fois, lancé dans la mémoire. */
export const PROFIL_ARCHIVISTE = 'archiviste';

/**
 * Qui lance un profil : `dialogue`, le choix de Nouvelle session ; `propre`, son propre chemin (l'archiviste et son tiroir),
 * montré à part dans le dialogue.
 */
export const LANCEURS_DE_PROFIL = ['dialogue', 'propre'] as const;
export type LanceurDeProfil = (typeof LANCEURS_DE_PROFIL)[number];

/** Profil d'une session lancée sans profil choisi, ou avec un nom de profil invalide. */
export const PROFIL_TRAVAIL = 'travail';
