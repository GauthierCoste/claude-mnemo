/**
 * Serveurs MCP de l'app Claude : formes des noms acceptés à l'écriture (service, et son imitation du mode démo) ; celle des
 * noms de variables est aussi vérifiée dès la saisie (interface).
 */

/** Nom d'un serveur : 1 à 64 lettres, chiffres, « _ », « . » ou « - ». */
export const MOTIF_NOM_SERVEUR = /^[A-Za-z0-9_.-]{1,64}$/u;
/** Nom d'une variable d'environnement : lettres, chiffres et « _ », sans chiffre au début. */
export const MOTIF_NOM_VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/u;
