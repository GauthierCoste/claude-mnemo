/** Groupes de réglages, dans l'ordre de la page Réglages. */
export const GROUPES_REGLAGES = ['contexte', 'entrainement', 'memoire', 'archiviste', 'recherche', 'projets', 'modeles', 'service', 'interface'] as const;
export type GroupeReglage = (typeof GROUPES_REGLAGES)[number];

/** Vert de Mnemo : défaut de `interface.accent` (couleur principale de l'interface), valeur de `--ac` dans `jetons.css`. */
export const ACCENT_PAR_DEFAUT = '#7df0c6';

/** Une couleur `#rrggbb` (six chiffres hexadécimaux, casse libre). */
export const estCouleurHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/u.test(v);
