/**
 * Ce qu'un appel aux modèles locaux est en train de faire, pour l'afficher : `vectorisation` (calcul des vecteurs de la
 * mémoire), `recherche` (une recherche), `injection` (le choix des cartes d'un tour de session).
 */
export const OPERATIONS_MODELES = ['vectorisation', 'recherche', 'injection'] as const;
export type OperationModele = (typeof OPERATIONS_MODELES)[number];

export const estOperationModele = (v: unknown): v is OperationModele => typeof v === 'string' && (OPERATIONS_MODELES as readonly string[]).includes(v);

/**
 * Avancement d'une vectorisation : vecteurs calculés, et total à calculer, sur l'ensemble de la passe ; `total` null : pas
 * encore compté (premier lot d'une passe).
 */
export type AvancementModele = { faits: number; total: number | null };
