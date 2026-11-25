/**
 * Outils du serveur MCP `mnemo` permis d'avance dans une session lancée par Mnemo, quel que soit le moteur : `proposer`, que
 * le bilan demande, et la lecture (`diagnostiquer` compris). Sans eux, le bilan s'arrêterait sur une demande de permission.
 * Ni `deplacer`, ni `entretenir`, ni `extraire_source`.
 */
export const OUTILS_MNEMO_PERMIS: readonly string[] = ['proposer', 'chercher', 'lire', 'lister', 'voisins', 'chronologie', 'contexte', 'diagnostiquer'];
