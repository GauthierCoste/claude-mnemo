/**
 * Textes de l'app de bureau dans une langue : la forme de la liste française (`fr.ts`), traduite dans `en.ts`. Le nom de
 * chaque langue, lui, s'écrit dans sa propre langue, quelle que soit celle des textes.
 */
import { type Langue, langueDuSysteme } from '@mnemo/commun';
import { en } from './en.ts';
import type { Forme } from './forme.ts';
import { fr } from './fr.ts';

export type TextesApp = Forme<typeof fr>;

const TEXTES: Record<Langue, TextesApp> = { fr, en };

export function textesApp(langue: Langue): TextesApp {
	return TEXTES[langue];
}

/** Les textes de référence : valeur par défaut d'un appelant qui n'a pas de langue (tests, outils). */
export const TEXTES_FR: TextesApp = fr;

/**
 * Langue du processus principal : la dernière connue (`preferences.json` : celle de l'interface, ou choisie dans
 * l'assistant), sinon celle du système (`app.getLocale()`).
 */
export function langueDeLApp(retenue: Langue | null, etiquetteSysteme: string): Langue {
	return retenue ?? langueDuSysteme(etiquetteSysteme);
}

/** Le nom de chaque langue, dans sa propre langue (choix de l'assistant). */
export const NOMS_LANGUES: Readonly<Record<Langue, string>> = { fr: 'Français', en: 'English' };
