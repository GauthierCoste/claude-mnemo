/**
 * Fenêtre de l'app : l'interface du service (`BrowserWindow`), isolée (`contextIsolation`, `sandbox`, ni Node ni preload),
 * limitée à l'origine du service (le reste : le navigateur, pour `http`/`https`, sinon rien). Chargée sur
 * `#jeton=<jeton>` (le fragment ne quitte pas la fenêtre ; jamais écrit dans un journal), rechargée si le service change de
 * port ou de jeton ; une session s'ouvre par `#session=<id>` sur la page déjà chargée (navigation dans la page, sans
 * rechargement). Créée cachée, elle se montre à sa première peinture. Fermer la cache (l'app reste dans la barre des
 * menus) ; taille et position retenues.
 */
import { app, BrowserWindow, screen, shell } from 'electron';
import {
	adresseFenetre,
	agentUtilisateur,
	type Bornes,
	bornesAOuvrir,
	decisionNavigation,
	FOND_FENETRE,
	origineService,
	POSITION_BOUTONS_FENETRE,
	TAILLE_DEFAUT,
	TAILLE_MIN,
} from '../domaine/fenetre.ts';
import type { ServiceLocal } from '../infra/service-local.ts';

export type Fenetre = {
	/** Montre la fenêtre sur le service (chargée au besoin), et sur la session `session` si elle est donnée. */
	montrer(service: ServiceLocal, session?: string): void;
	/** Le service rattaché a changé : recharge une fenêtre chargée sur un autre port ou un autre jeton. */
	serviceChange(service: ServiceLocal | null): void;
	/** Fenêtre visible et au premier plan (les notifications se taisent alors). */
	auFocus(): boolean;
	/** L'app quitte : la fermeture n'est plus empêchée. */
	quitter(): void;
};

export type OptionsFenetre = {
	bornesRetenues: Bornes | null;
	retenirBornes: (b: Bornes) => void;
	/** Appelé quand la fenêtre est montrée ou cachée (Dock). */
	surVisibilite: (visible: boolean) => void;
};

/** Permissions accordées à l'interface : écrire dans le presse-papiers (« Copier »), le plein écran. */
const PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen']);

const ATTENTE_PEINTURE_MS = 3000;

const ouvrirAilleurs = (adresse: string, origine: string): void => {
	if (decisionNavigation(adresse, origine) === 'externe') void shell.openExternal(adresse).catch(() => {});
};

export function creerFenetre(o: OptionsFenetre): Fenetre {
	let fenetre: BrowserWindow | null = null;
	/** Service dont l'adresse à jeton est chargée dans la fenêtre. */
	let charge: ServiceLocal | null = null;
	let quitte = false;
	/** La fenêtre a été peinte une fois (`ready-to-show`) ; avant, la montrer attend (`ATTENTE_PEINTURE_MS` au plus). */
	let pret = false;
	const attentes: (() => void)[] = [];

	const memePage = (a: ServiceLocal, b: ServiceLocal) => a.port === b.port && a.jeton === b.jeton;
	const origine = () => (charge === null ? null : origineService(charge.port));

	function bornes(f: BrowserWindow): Bornes {
		const b = f.getNormalBounds();
		return { x: b.x, y: b.y, largeur: b.width, hauteur: b.height };
	}

	function creer(): BrowserWindow {
		const ecrans = screen.getAllDisplays().map((d) => ({ x: d.workArea.x, y: d.workArea.y, largeur: d.workArea.width, hauteur: d.workArea.height }));
		const b = bornesAOuvrir(o.bornesRetenues, ecrans);
		const f = new BrowserWindow({
			...(b === null ? { width: TAILLE_DEFAUT.largeur, height: TAILLE_DEFAUT.hauteur, center: true } : { x: b.x, y: b.y, width: b.largeur, height: b.hauteur }),
			minWidth: TAILLE_MIN.largeur,
			minHeight: TAILLE_MIN.hauteur,
			title: 'Mnemo',
			show: false,
			titleBarStyle: 'hidden',
			trafficLightPosition: POSITION_BOUTONS_FENETRE,
			backgroundColor: FOND_FENETRE,
			webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false },
		});
		const contenu = f.webContents;
		// avant tout chargement : l'interface se met en pleine fenêtre quand elle voit la marque de l'app
		contenu.setUserAgent(agentUtilisateur(contenu.getUserAgent(), app.getVersion()));
		const garder = (evenement: { preventDefault(): void }, adresse: string) => {
			const o2 = origine();
			if (o2 !== null && decisionNavigation(adresse, o2) === 'autoriser') return;
			evenement.preventDefault();
			if (o2 !== null) ouvrirAilleurs(adresse, o2);
		};
		contenu.on('will-navigate', (e) => garder(e, e.url));
		contenu.on('will-redirect', (e) => garder(e, e.url));
		contenu.on('will-attach-webview', (e) => e.preventDefault());
		contenu.setWindowOpenHandler(({ url }) => {
			const o2 = origine();
			if (o2 !== null) ouvrirAilleurs(url, o2);
			return { action: 'deny' };
		});
		// l'adresse de qui demande (un cadre d'une autre origine n'hérite pas des droits de la page)
		contenu.session.setPermissionRequestHandler((_wc, permission, rappel, details) => {
			const o2 = origine();
			rappel(o2 !== null && PERMISSIONS.has(permission) && decisionNavigation(details.requestingUrl, o2) === 'autoriser');
		});
		contenu.session.setPermissionCheckHandler((_wc, permission, origineDemande) => {
			const o2 = origine();
			return o2 !== null && PERMISSIONS.has(permission) && origineDemande === o2;
		});
		f.on('close', (e) => {
			o.retenirBornes(bornes(f));
			if (quitte) return;
			e.preventDefault();
			// cachée en plein écran, elle laisserait un espace noir : sortir du plein écran d'abord
			if (f.isFullScreen()) {
				f.once('leave-full-screen', () => f.hide());
				f.setFullScreen(false);
			} else f.hide();
		});
		f.on('hide', () => o.surVisibilite(false));
		f.on('show', () => o.surVisibilite(true));
		// première peinture : l'interface a posé sa marque de pleine fenêtre (pas de saut de marge à l'affichage)
		f.once('ready-to-show', () => {
			pret = true;
			for (const montrerQuandPret of attentes.splice(0)) montrerQuandPret();
		});
		f.on('closed', () => {
			if (fenetre === f) fenetre = null;
			charge = null;
			pret = false;
			attentes.length = 0;
		});
		return f;
	}

	/** Charge l'adresse à jeton du service, et la session demandée dans le même fragment (`#jeton=…&session=…`). */
	function charger(f: BrowserWindow, service: ServiceLocal, session: string | undefined): void {
		charge = service;
		// l'échec du chargement (service tombé entre-temps) n'est pas journalisé : l'adresse porte le jeton
		void f.loadURL(adresseFenetre(service.port, session === undefined ? { jeton: service.jeton } : { jeton: service.jeton, session })).catch(() => {});
	}

	/**
	 * Session sur la page chargée : seul le fragment change (pas de rechargement). Page encore en chargement : un
	 * `#session=` seul l'interromprait et rechargerait sans le jeton (perdu à la première ouverture) ; on recharge alors
	 * avec les deux.
	 */
	function ouvrirSession(f: BrowserWindow, service: ServiceLocal, session: string): void {
		if (f.webContents.isLoadingMainFrame()) charger(f, service, session);
		else void f.loadURL(adresseFenetre(service.port, { session })).catch(() => {});
	}

	return {
		montrer(service, session) {
			if (fenetre === null) fenetre = creer();
			const f = fenetre;
			if (charge === null || !memePage(charge, service)) charger(f, service, session);
			else if (session !== undefined) ouvrirSession(f, service, session);
			const afficher = () => {
				if (f.isDestroyed()) return;
				if (f.isMinimized()) f.restore();
				f.show();
				f.focus();
				app.focus({ steal: true });
			};
			if (pret) afficher();
			else {
				attentes.push(afficher);
				// page qui ne se peint pas (service tombé entre-temps) : la fenêtre se montre quand même
				setTimeout(() => {
					const i = attentes.indexOf(afficher);
					if (i !== -1) attentes.splice(i, 1)[0]!();
				}, ATTENTE_PEINTURE_MS);
			}
		},
		serviceChange(service) {
			if (fenetre === null || charge === null || service === null || memePage(charge, service)) return;
			charger(fenetre, service, undefined);
		},
		auFocus: () => fenetre !== null && fenetre.isVisible() && fenetre.isFocused(),
		quitter() {
			quitte = true;
		},
	};
}
