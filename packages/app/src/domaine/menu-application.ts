/**
 * Menu de l'application, en données (Electron le traduit tel quel, `electron/menu-application.ts`) : « Mnemo » (sous macOS
 * les éléments standard, à propos, masquer ; « Quitter Mnemo » partout), l'édition (copier et coller dans le terminal), la
 * présentation et la fenêtre. « Quitter Mnemo » : ⌘Q sous macOS, Ctrl+Q sous Windows (`CmdOrCtrl+Q`). Sous Windows, la
 * barre des menus est cachée (la barre de titre est dessinée par l'interface) : seuls ses raccourcis servent.
 */
import { TEXTES_FR, type TextesApp } from './langue/textes.ts';
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

export function modeleMenuApplication(plateforme: PlateformeApp, t: TextesApp = TEXTES_FR): ElementMenuApplication[] {
	const m = t.menuApplication;
	const quitter: ElementMenuApplication = { type: 'quitter', libelle: m.quitter, raccourci: 'CmdOrCtrl+Q' };
	// à propos, masquer, tout afficher : propres à macOS
	const mnemo = plateforme === 'win32' ? [quitter] : [role('about', m.aPropos), SEPARATEUR, role('hide', m.masquer), role('hideOthers', m.masquerAutres), role('unhide', m.toutAfficher), SEPARATEUR, quitter];
	return [
		{ type: 'sousMenu', libelle: 'Mnemo', elements: mnemo },
		role('editMenu', m.edition),
		{ type: 'sousMenu', libelle: m.presentation, elements: [role('reload', m.recharger), SEPARATEUR, role('resetZoom', m.tailleReelle), role('zoomIn', m.zoomAvant), role('zoomOut', m.zoomArriere), SEPARATEUR, role('togglefullscreen', m.pleinEcran)] },
		role('windowMenu', m.fenetre),
	];
}
