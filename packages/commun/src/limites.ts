/** Documents récents rendus par `documents`. */
export const DOCUMENTS_MAX = 50;
/** Fiches « à traiter » rendues par `documents`. */
export const A_TRAITER_MAX = 500;
/** Sessions qui ont utilisé une fiche, rendues par `fiche` (les plus récentes). */
export const SESSIONS_DE_FICHE_MAX = 20;
/** Fichiers modifiés rendus par `dossierGit`, par dossier. */
export const FICHIERS_GIT_MAX = 20;
/** Chemins d'un lot reçus par `depotTraiter` et `sourcesTraiter`. */
export const CHEMINS_LOT_MAX = 500;
/** Fiches en cours laissées de côté (`sauf`) reçues par `sourcesTraiterToutes`. */
export const SAUF_MAX = 10_000;
/** Fiches qu'une consigne à l'archiviste nomme, au plus ; au-delà, elle désigne la marque « à traiter ». */
export const CONSIGNE_CHEMINS_MAX = 20;
/** Objectif d'une session, passé à `claude` comme prompt initial (en caractères). */
export const OBJECTIF_MAX = 10_000;
