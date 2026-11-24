/** Thème xterm lu dans les jetons `--terminal-*` de `jetons.css` (aucune couleur écrite ici). */
import type { ITheme } from '@xterm/xterm';

const CORRESPONDANCE: [keyof ITheme, string][] = [
	['background', '--terminal-fond'],
	['foreground', '--terminal-texte'],
	['cursor', '--terminal-curseur'],
	['cursorAccent', '--terminal-fond'],
	['selectionBackground', '--terminal-selection'],
	['black', '--terminal-noir'],
	['red', '--terminal-rouge'],
	['green', '--terminal-vert'],
	['yellow', '--terminal-jaune'],
	['blue', '--terminal-bleu'],
	['magenta', '--terminal-magenta'],
	['cyan', '--terminal-cyan'],
	['white', '--terminal-blanc'],
	['brightBlack', '--terminal-noir-vif'],
	['brightRed', '--terminal-rouge-vif'],
	['brightGreen', '--terminal-vert-vif'],
	['brightYellow', '--terminal-jaune-vif'],
	['brightBlue', '--terminal-bleu-vif'],
	['brightMagenta', '--terminal-magenta-vif'],
	['brightCyan', '--terminal-cyan-vif'],
	['brightWhite', '--terminal-blanc-vif'],
];

/** `lire(nom)` rend la valeur calculée d'une variable CSS ; un jeton absent laisse la couleur par défaut d'xterm. */
export function themeDepuisJetons(lire: (nom: string) => string): ITheme {
	const theme: Record<string, string> = {};
	for (const [cle, jeton] of CORRESPONDANCE) {
		const valeur = lire(jeton).trim();
		if (valeur) theme[cle] = valeur;
	}
	return theme as ITheme;
}
