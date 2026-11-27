import type { Langue } from '@mnemo/commun';
import type { Forme } from './forme.ts';
import { en } from './textes/en/index.ts';
import { fr } from './textes/fr/index.ts';

/** Tous les textes de l'interface dans une langue : la forme de la liste française. */
export type Textes = Forme<typeof fr>;

export const TEXTES: Record<Langue, Textes> = { fr, en };
