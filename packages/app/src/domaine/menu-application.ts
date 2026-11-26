/**
 * Menu de l'application, en données (Electron le traduit tel quel, `electron/menu-application.ts`) : « Mnemo » (sous macOS
 * les éléments standard, à propos, masquer ; « Quitter Mnemo » partout), l'édition (copier et coller dans le terminal), la
 * présentation et la fenêtre. « Quitter Mnemo » : ⌘Q sous macOS, Ctrl+Q sous Windows (`CmdOrCtrl+Q`). Sous Windows, la
 * barre des menus est cachée (la barre de titre est dessinée par l'interface) : seuls ses raccourcis servent.
 */
import type { PlateformeApp } from './plateforme.ts';

/** Rôles standard d'Electron utilisés ici. */
export type RoleMenu = 'about' | 'hide' | 'hideOthers' | 'unhide' | 'editMenu' | 'reload' | 'resetZoom' | 'zoomIn' | 'zoomOut' | 'togglefullscreen' | 'windowMenu';

export type ElementMenuApplication =
	| { type: 'separateur' }
	| { type: 'role'; role: RoleMenu; libelle: string }
	| { type: 'quitter'; libelle: string; raccourci: string }
	| { type: 'sousMenu'; libelle: string; elements: ElementMenuApplication[] };

const SEPARATEUR: ElementMenuApplication = { type: 'separateur' };
const role = (r: RoleMenu, libelle: string): ElementMenuApplication => ({ type: 'role', role: r, libelle });

export function modeleMenuApplication(plateforme: PlateformeApp): ElementMenuApplication[] {
	const quitter: ElementMenuApplication = { type: 'quitter', libelle: 'Quitter Mnemo', raccourci: 'CmdOrCtrl+Q' };
	// à propos, masquer, tout afficher : propres à macOS
	const mnemo = plateforme === 'win32' ? [quitter] : [role('about', 'À propos de Mnemo'), SEPARATEUR, role('hide', 'Masquer Mnemo'), role('hideOthers', 'Masquer les autres'), role('unhide', 'Tout afficher'), SEPARATEUR, quitter];
	return [
		{ type: 'sousMenu', libelle: 'Mnemo', elements: mnemo },
		role('editMenu', 'Édition'),
		{ type: 'sousMenu', libelle: 'Présentation', elements: [role('reload', 'Recharger'), SEPARATEUR, role('resetZoom', 'Taille réelle'), role('zoomIn', 'Zoom avant'), role('zoomOut', 'Zoom arrière'), SEPARATEUR, role('togglefullscreen', 'Plein écran')] },
		role('windowMenu', 'Fenêtre'),
	];
}
