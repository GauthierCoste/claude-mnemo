import { describe, expect, it } from 'vitest';
import { type ElementMenuApplication, modeleMenuApplication } from '../../src/domaine/menu-application.ts';

/** Le menu en lignes : `—` séparateur, `[rôle] libellé`, `libellé (raccourci)`, sous-menus indentés. */
function lignes(elements: readonly ElementMenuApplication[], retrait = ''): string[] {
	return elements.flatMap((e) => {
		switch (e.type) {
			case 'separateur':
				return [`${retrait}—`];
			case 'role':
				return [`${retrait}[${e.role}] ${e.libelle}`];
			case 'quitter':
				return [`${retrait}${e.libelle} (${e.raccourci})`];
			case 'sousMenu':
				return [`${retrait}${e.libelle}`, ...lignes(e.elements, `${retrait}  `)];
		}
	});
}

const SUITE = ['[editMenu] Édition', 'Présentation', '  [reload] Recharger', '  —', '  [resetZoom] Taille réelle', '  [zoomIn] Zoom avant', '  [zoomOut] Zoom arrière', '  —', '  [togglefullscreen] Plein écran', '[windowMenu] Fenêtre'];

describe('menu de l’application', () => {
	it('macOS : les éléments standard, « Quitter Mnemo » à ⌘Q', () => {
		expect(lignes(modeleMenuApplication('darwin'))).toEqual(['Mnemo', '  [about] À propos de Mnemo', '  —', '  [hide] Masquer Mnemo', '  [hideOthers] Masquer les autres', '  [unhide] Tout afficher', '  —', '  Quitter Mnemo (CmdOrCtrl+Q)', ...SUITE]);
	});

	it('Windows : ni à propos ni masquer (propres à macOS), « Quitter Mnemo » à Ctrl+Q, l’édition gardée', () => {
		expect(lignes(modeleMenuApplication('win32'))).toEqual(['Mnemo', '  Quitter Mnemo (CmdOrCtrl+Q)', ...SUITE]);
	});
});
