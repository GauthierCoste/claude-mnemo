/**
 * Menu de l'application (en haut de l'écran quand la fenêtre est au premier plan) : les menus standard de macOS (édition
 * pour copier et coller dans le terminal, présentation, fenêtre), et « Quitter Mnemo » (⌘Q) qui passe par la question
 * de l'arrêt du service, comme celui de la barre des menus. Quitter depuis le Dock ou à la fermeture de la session macOS
 * ne pose pas de question : le service continue.
 */
import { Menu } from 'electron';

export function installerMenuApplication(o: { quitter: () => void }): void {
	Menu.setApplicationMenu(
		Menu.buildFromTemplate([
			{
				label: 'Mnemo',
				submenu: [
					{ role: 'about', label: 'À propos de Mnemo' },
					{ type: 'separator' },
					{ role: 'hide', label: 'Masquer Mnemo' },
					{ role: 'hideOthers', label: 'Masquer les autres' },
					{ role: 'unhide', label: 'Tout afficher' },
					{ type: 'separator' },
					{ label: 'Quitter Mnemo', accelerator: 'Command+Q', click: o.quitter },
				],
			},
			{ role: 'editMenu', label: 'Édition' },
			{
				label: 'Présentation',
				submenu: [{ role: 'reload', label: 'Recharger' }, { type: 'separator' }, { role: 'resetZoom', label: 'Taille réelle' }, { role: 'zoomIn', label: 'Zoom avant' }, { role: 'zoomOut', label: 'Zoom arrière' }, { type: 'separator' }, { role: 'togglefullscreen', label: 'Plein écran' }],
			},
			{ role: 'windowMenu', label: 'Fenêtre' },
		]),
	);
}
