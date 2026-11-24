/**
 * Nom du dossier de la mémoire sous la racine du dossier Mnemo (le dépôt git des fiches). Le « _ » le garde en tête des listes
 * de fichiers. Seul endroit où ce nom s'écrit : tout le reste l'importe.
 */
export const DOSSIER_MEMOIRE = '_mnemo';

/** Nom du dossier de l'état local de Mnemo sous la racine (service, réglages, dépôts en cours), jamais versionné. */
export const DOSSIER_LOCAL = '.mnemo';

/** Dossiers de Mnemo lui-même sous la racine : jamais listés, jamais destination d'une session ni d'un dépôt. */
export const DOSSIERS_DE_MNEMO = [DOSSIER_MEMOIRE, DOSSIER_LOCAL] as const;
