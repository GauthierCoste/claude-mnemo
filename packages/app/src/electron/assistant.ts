/**
 * Fenêtre de l'assistant d'installation : page locale du paquet (`dist/assistant/index.html`), preload minimal
 * (`dist/assistant/preload.cjs`), session à part (en mémoire) qui ne charge que les fichiers de la page et refuse toute
 * permission, navigation bloquée ; seuls les liens d'installation (git, Claude Code) s'ouvrent, dans le navigateur. Chaque
 * demande IPC est vérifiée (elle vient de cette page) puis confiée au contrôleur (`infra/assistant.ts`), qui la valide.
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, dialog, ipcMain, session, shell, type IpcMainInvokeEvent } from 'electron';
import type { ExecutableMnemo } from '../domaine/assistant.ts';
import { CANAUX_ASSISTANT as C, lienAutorise } from '../domaine/assistant-pont.ts';
import { optionsBarreTitre } from '../domaine/fenetre.ts';
import { plateformeApp } from '../domaine/plateforme.ts';
import { controleurAssistant, type FinAssistant } from '../infra/assistant.ts';

export type OptionsAssistant = {
	/** Mnemo à lancer (`decisionAuLancement`) ; null : la page explique comment installer l'app. */
	executable: ExecutableMnemo | null;
	/** L'app tourne depuis un emplacement provisoire : la page demande seulement de la glisser dans Applications. */
	provisoire?: boolean;
	/** Dossier personnel (`dossierPersonnel()`, celui de `HOME`) : la configuration est écrite dessous. */
	home: string;
	/** `MNEMO_PORT` de la configuration précédente, gardé dans la nouvelle. */
	port?: number;
	/**
	 * Configuration écrite : ouvrir l'interface (et appliquer `ouvrirALaSession` par `app.setLoginItemSettings`). Attendu
	 * avant que la fenêtre de l'assistant se ferme (la page montre « Ouverture… » pendant ce temps) ; une exception est
	 * montrée sur la page.
	 */
	surTermine(fin: FinAssistant): void | Promise<void>;
	/** Fenêtre fermée sans avoir terminé (rien n'est écrit) : à l'app de décider (quitter, par exemple). */
	surAbandon?(): void;
	/** Dossier de `main.js` (qui contient `assistant/`) ; par défaut celui de ce module construit. */
	dossierDist?: string;
};

const PARTITION = 'mnemo-assistant';
const CANAUX_INVOQUES = [C.verifierPoste, C.choisirDossier, C.installer, C.terminer] as const;

let ouverte: BrowserWindow | null = null;

/** Ouvre la fenêtre de l'assistant (ou montre celle déjà ouverte) et la rend. */
export function ouvrirAssistant(o: OptionsAssistant): BrowserWindow {
	if (ouverte !== null && !ouverte.isDestroyed()) {
		ouverte.show();
		ouverte.focus();
		return ouverte;
	}
	const dossier = join(o.dossierDist ?? import.meta.dirname, 'assistant');
	const page = join(dossier, 'index.html');
	const urlPage = pathToFileURL(page).href;
	const prefixe = `${pathToFileURL(dossier).href}/`;

	const ses = session.fromPartition(PARTITION);
	ses.setPermissionRequestHandler((_w, _p, rappel) => rappel(false));
	ses.setPermissionCheckHandler(() => false);
	// aucun accès réseau : seuls les fichiers de la page se chargent
	ses.webRequest.onBeforeRequest((details, rappel) => rappel({ cancel: !details.url.startsWith(prefixe) }));

	const fenetre = new BrowserWindow({
		width: 760,
		height: 600,
		minWidth: 640,
		minHeight: 540,
		show: false,
		title: 'Mnemo',
		...optionsBarreTitre(plateformeApp(process.platform), null),
		backgroundColor: '#050506',
		webPreferences: {
			preload: join(dossier, 'preload.cjs'),
			partition: PARTITION,
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			webSecurity: true,
			spellcheck: false,
			navigateOnDragDrop: false,
		},
	});
	ouverte = fenetre;
	const wc = fenetre.webContents;
	fenetre.once('ready-to-show', () => fenetre.show());
	wc.on('will-navigate', (e) => e.preventDefault());
	wc.on('will-redirect', (e) => e.preventDefault());
	wc.on('will-attach-webview', (e) => e.preventDefault());
	wc.setWindowOpenHandler(({ url }) => {
		if (lienAutorise(url)) void shell.openExternal(url);
		return { action: 'deny' };
	});

	let termine = false;
	/** `terminer` en cours : la configuration peut être écrite et l'interface en train de s'ouvrir. */
	let terminaisons = 0;
	const controleur = controleurAssistant({
		executable: o.executable,
		...(o.provisoire === true ? { provisoire: true } : {}),
		home: o.home,
		...(o.port === undefined ? {} : { port: o.port }),
		async choisirDossierNatif() {
			const r = await dialog.showOpenDialog(fenetre, { title: 'Dossier Mnemo', buttonLabel: 'Choisir', properties: ['openDirectory', 'createDirectory'] });
			return r.canceled ? null : (r.filePaths[0] ?? null);
		},
		envoyerLigne(ligne) {
			if (!wc.isDestroyed()) wc.send(C.ligne, ligne);
		},
		surTermine: (fin) => o.surTermine(fin),
	});

	/** La demande vient du cadre principal de cette fenêtre, sur la page de l'assistant. */
	const depuisLaPage = (e: IpcMainInvokeEvent): boolean => e.sender === wc && e.senderFrame !== null && e.senderFrame === wc.mainFrame && e.senderFrame.url.split('#')[0] === urlPage;
	const gerer = (canal: (typeof CANAUX_INVOQUES)[number], traiter: (...args: unknown[]) => Promise<unknown>) => {
		ipcMain.removeHandler(canal);
		ipcMain.handle(canal, (e, ...args: unknown[]) => {
			if (!depuisLaPage(e)) throw new Error('Demande refusée.');
			return traiter(...args);
		});
	};
	gerer(C.verifierPoste, () => controleur.verifierPoste());
	gerer(C.choisirDossier, () => controleur.choisirDossier());
	gerer(C.installer, (choix) => controleur.installer(choix));
	gerer(C.terminer, async () => {
		terminaisons++;
		const r = await controleur.terminer().finally(() => {
			terminaisons--;
		});
		// fenêtre fermée entre-temps et Mnemo pas ouvert : l'abandon qu'on avait différé
		if (!r.ok && terminaisons === 0 && fenetre.isDestroyed()) o.surAbandon?.();
		if (r.ok) {
			termine = true;
			setImmediate(() => {
				if (!fenetre.isDestroyed()) fenetre.close();
			});
		}
		return r;
	});

	fenetre.on('closed', () => {
		for (const canal of CANAUX_INVOQUES) ipcMain.removeHandler(canal);
		controleur.abandonner();
		if (ouverte === fenetre) ouverte = null;
		// fermée pendant `terminer` : l'interface s'ouvre peut-être, ce n'est pas un abandon
		if (!termine && terminaisons === 0) o.surAbandon?.();
	});
	fenetre.loadFile(page).catch((erreur: unknown) => console.error(`Assistant : page non chargée (${page}) : ${erreur instanceof Error ? erreur.message : String(erreur)}`));
	return fenetre;
}
