/**
 * Menu de l'application (en haut de l'écran quand la fenêtre est au premier plan sous macOS ; caché sous Windows, où seuls
 * ses raccourcis servent), traduit du modèle du domaine (`domaine/menu-application.ts`) : les menus standard (édition pour
 * copier et coller dans le terminal, présentation, fenêtre), et « Quitter Mnemo » (⌘Q, Ctrl+Q) qui passe par la question
 * de l'arrêt du service, comme celui de la barre des menus. Quitter depuis le Dock ou à la fermeture de la session macOS
 * ne pose pas de question : le service continue.
 */
import { Menu, type MenuItemConstructorOptions } from 'electron';
import { type ElementMenuApplication, modeleMenuApplication } from '../domaine/menu-application.ts';
import { plateformeApp } from '../domaine/plateforme.ts';

function traduire(e: ElementMenuApplication, quitter: () => void): MenuItemConstructorOptions {
	switch (e.type) {
		case 'separateur':
			return { type: 'separator' };
		case 'role':
			return { role: e.role, label: e.libelle };
		case 'quitter':
			return { label: e.libelle, accelerator: e.raccourci, click: quitter };
		case 'sousMenu':
			return { label: e.libelle, submenu: e.elements.map((s) => traduire(s, quitter)) };
	}
}

export function installerMenuApplication(o: { quitter: () => void }): void {
	Menu.setApplicationMenu(Menu.buildFromTemplate(modeleMenuApplication(plateformeApp(process.platform)).map((e) => traduire(e, o.quitter))));
}
