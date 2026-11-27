/**
 * Cycle de vie de l'application Electron (seul dossier qui importe `electron`) : instance unique ; l'assistant
 * d'installation (sans configuration, ou sans mémoire) ; puis le suivi du service, la barre des menus, la fenêtre, le Dock,
 * les notifications, les nouvelles versions, la vérification de l'installation (app empaquetée), « Désinstaller Mnemo… »
 * et « Quitter Mnemo ». Mince : ce qui se décide sans Electron est dans le domaine.
 *
 * Le dossier de données d'Electron est le dossier de l'app (`~/Library/Application Support/Mnemo`, sous le dossier
 * personnel de `HOME` ; sous Windows `%APPDATA%\Mnemo` ; voir `infra/dossiers.ts`), celui de `config.json`, de
 * `preferences.json` et du journal de l'app ; en essai, un dossier temporaire.
 *
 * Sous Windows : identifiant de modèle d'application posé avant tout (notifications), icône dans la zone de notification,
 * élément d'ouverture de session lu et retiré avec les mêmes options qu'à l'inscription, et l'app retirée par son
 * désinstalleur, ouvert (par le shell de Windows, qui demande l'élévation s'il le faut) juste avant que Mnemo quitte.
 *
 * Langue : celle de `preferences.json` (la dernière connue), sinon celle du système. Elle suit celle de l'interface (`lang`
 * de la page, lu par la fenêtre) et celle choisie dans l'assistant ; à chaque changement, elle est retenue et les deux
 * menus sont refaits.
 */
import { sep } from 'node:path';
import type { Langue } from '@mnemo/commun';
import { app, nativeImage, Notification, shell } from 'electron';
import type { Configuration, Lancement } from '../domaine/configuration.ts';
import { bilanDesinstallation, type EntreeDesinstallation, planDesinstallation } from '../domaine/desinstallation.ts';
import { iconeDockDeLaPage } from '../domaine/dock.ts';
import { toutesLesImages } from '../domaine/icone.ts';
import { IDENTIFIANT_APP, NOM_APP } from '../domaine/identite-app.ts';
import { langueDeLApp, TEXTES_FR, textesApp, type TextesApp } from '../domaine/langue/textes.ts';
import type { ActionMenu } from '../domaine/menu.ts';
import { optionsOuvertureSession, ouverteParLaSession } from '../domaine/ouverture-session.ts';
import { plateformeApp } from '../domaine/plateforme.ts';
import { suiteQuitter } from '../domaine/quitter.ts';
import { estPageDeVersion, verificationDue, versionAAnnoncer } from '../domaine/version.ts';
import { vueApp } from '../domaine/vue.ts';
import { accesReel } from '../infra/acces-service.ts';
import { decisionAuLancement } from '../infra/assistant.ts';
import { cheminConfiguration, remplacerPathConfiguration } from '../infra/configuration-fichier.ts';
import { actionsFichiers, executerEtapes } from '../infra/desinstallation.ts';
import { dossierApp, dossierEssai, dossierPersonnel } from '../infra/dossiers.ts';
import { desinstalleurWindows, emplacementProvisoire, lancementDuPaquet, paquetDeLApp } from '../infra/emplacement.ts';
import { dossierImages, lireImagesBarre } from '../infra/images-barre.ts';
import { cheminsInstallation, lireEtatInstallation } from '../infra/installation-fichiers.ts';
import { cheminJournalApp, journalFichier } from '../infra/journal-app.ts';
import { lirePathTerminal } from '../infra/path-terminal.ts';
import { cheminPreferences as cheminPreferencesDe, lirePreferencesFichier, preferencesRetenues, type PreferencesRetenues } from '../infra/preferences-fichier.ts';
import { cheminJournal } from '../infra/service-local.ts';
import { creerSuivi, type InstantaneSuivi, type SuiviService } from '../infra/suivi-service.ts';
import { verifierInstallation } from '../infra/verification-installation.ts';
import { derniereVersionPubliee } from '../infra/versions.ts';
import { ouvrirAssistant } from './assistant.ts';
import { creerBarre } from './barre.ts';
import { demanderDesinstaller, demanderQuitter, demanderRedemarrer, direBilan, direErreur, direInformation } from './boites.ts';
import { creerFenetre } from './fenetre.ts';
import { installerMenuApplication } from './menu-application.ts';

/** Message écrit sur la sortie standard en mode essai, une fois l'application prête. */
export const MESSAGE_ESSAI = 'mnemo-app : prête';

const PLATEFORME = plateformeApp(process.platform);

/** La recherche de version (une par jour au plus) est réexaminée toutes les heures : l'app peut rester ouverte des jours. */
const INTERVALLE_EXAMEN_VERSION_MS = 60 * 60 * 1000;

/**
 * Démarre l'application ; `essai` : quitte dès qu'elle est prête (images de la barre des menus lues), après l'avoir dit
 * sur la sortie standard. `dossierMain` : le dossier du `main.js` construit (les images sont à côté).
 */
export function demarrerApplication(options: { essai: boolean; dossierMain: string }): void {
	app.setName(NOM_APP);
	// Windows : sans lui, les notifications ne s'affichent pas (et l'app est mal regroupée dans la barre des tâches)
	if (PLATEFORME === 'win32') app.setAppUserModelId(IDENTIFIANT_APP);
	const images = dossierImages(options.dossierMain);
	if (options.essai) {
		app.setPath('userData', dossierEssai());
		void app.whenReady().then(() => {
			try {
				lireImagesBarre(images, toutesLesImages());
			} catch (e) {
				process.stderr.write(`mnemo-app : ${e instanceof Error ? e.message : String(e)}\n`);
				app.exit(1);
				return;
			}
			process.stdout.write(`${MESSAGE_ESSAI}\n`);
			app.quit();
		});
		return;
	}
	const home = dossierPersonnel();
	app.setPath('userData', dossierApp(home));
	if (!app.requestSingleInstanceLock()) {
		app.quit();
		return;
	}
	// l'app vit dans la barre des menus : elle ne quitte pas quand sa fenêtre se ferme, ni quand l'assistant se ferme après
	// avoir fini (son abandon, lui, quitte : `surAbandon`)
	app.on('window-all-closed', () => {});
	void app
		.whenReady()
		.then(() => lancer(home, images))
		.catch(async (e: unknown) => {
			// sans quoi l'app resterait ouverte sans barre des menus ni fenêtre, Dock caché, et garderait l'instance unique
			const t = textesAuDemarrage();
			await direErreur(t.erreurs.ouverture, e instanceof Error ? e.message : String(e), t).catch(() => {});
			app.exit(1);
		});
}

/** Textes d'une erreur au démarrage, avant que la langue soit tenue : celle des préférences, sinon celle du système. */
function textesAuDemarrage(): TextesApp {
	try {
		return textesApp(langueDeLApp(lirePreferencesFichier(cheminPreferencesDe(app.getPath('userData'))).langue, app.getLocale()));
	} catch {
		return TEXTES_FR;
	}
}

/**
 * Ce que l'assistant et l'interface partagent : les préférences (une seule copie : deux écritures ne s'écrasent pas), la
 * langue et ses textes, le menu de l'application.
 */
type ContexteApp = {
	preferences: PreferencesRetenues;
	langue(): Langue;
	textes(): TextesApp;
	/** La langue de l'interface ou de l'assistant : retenue ; si elle change, les menus sont refaits. */
	changerLangue(langue: Langue): void;
	/** Ce que fait « Quitter Mnemo » du menu de l'application (le menu est réinstallé). */
	quitterParLeMenu(quitter: () => void): void;
	/** Appelé après chaque changement de langue (la barre des menus de l'interface). */
	surLangue(f: () => void): void;
};

function contexteApp(dossier: string): ContexteApp {
	const preferences = preferencesRetenues(cheminPreferencesDe(dossier));
	const langue = (): Langue => langueDeLApp(preferences.valeur().langue, app.getLocale());
	const textes = (): TextesApp => textesApp(langue());
	let quitter: () => void = () => app.quit();
	let apresChangement: () => void = () => {};
	const installerMenu = (): void => installerMenuApplication({ quitter: () => quitter(), textes: textes() });
	return {
		preferences,
		langue,
		textes,
		changerLangue(nouvelle) {
			if (preferences.valeur().langue === nouvelle) return;
			const avant = langue();
			preferences.retenir({ langue: nouvelle });
			if (langue() === avant) return;
			installerMenu();
			apresChangement();
		},
		quitterParLeMenu(f) {
			quitter = f;
			installerMenu();
		},
		surLangue(f) {
			apresChangement = f;
		},
	};
}

/**
 * Options de l'élément d'ouverture de session, les mêmes pour l'inscrire, le lire et le retirer (sous Windows, l'élément
 * est identifié par l'exécutable et ses arguments : voir le domaine).
 */
const optionsSession = () => optionsOuvertureSession(PLATEFORME, app.getPath('exe'));

/** Inscrit ou retire l'ouverture à l'ouverture de session (l'argument n'est transmis que sous Windows : voir le domaine). */
function reglerOuvertureSession(active: boolean): void {
	app.setLoginItemSettings({ openAtLogin: active, ...optionsSession() });
}

/** L'élément d'ouverture de session tel que le système le voit (sous macOS, lu sans options, comme toujours). */
function lireOuvertureSession(): Electron.LoginItemSettings {
	return PLATEFORME === 'win32' ? app.getLoginItemSettings(optionsSession()) : app.getLoginItemSettings();
}

async function lancer(home: string, images: string): Promise<void> {
	// app empaquetée : son propre Node et son propre `main.ts` (ceux de la configuration sont ignorés)
	const paquet = lancementDuPaquet(app.isPackaged, process.resourcesPath);
	// depuis l'image disque ou une translocation, l'assistant n'installe rien : il demande de glisser Mnemo dans Applications
	const provisoire = paquet !== undefined && emplacementProvisoire(process.resourcesPath);
	// sans configuration, l'assistant lance `mnemo` (et écrit la configuration) avec le `PATH` du terminal : le shell de
	// connexion n'est lu que dans ce cas (repli au journal de l'app)
	const journal = journalFichier(cheminJournalApp(app.getPath('userData')));
	const contexte = contexteApp(app.getPath('userData'));
	const decision = await decisionAuLancement(home, paquet, async () => (await lirePathTerminal({ home, journal })).path, provisoire);
	// une seconde ouverture montre l'assistant tant qu'il est là, puis l'interface
	let secondeOuverture = (): void => {};
	app.on('second-instance', () => secondeOuverture());
	if (!decision.assistant) {
		secondeOuverture = await demarrerInterface(contexte, home, images, decision.configuration, paquet, false);
		return;
	}
	// l'assistant seul : ni barre des menus ni suivi du service tant qu'il n'a pas fini ; Dock visible
	contexte.quitterParLeMenu(() => app.quit());
	const options: Parameters<typeof ouvrirAssistant>[0] = {
		langue: contexte.langue,
		textes: contexte.textes,
		surLangue: (langue) => contexte.changerLangue(langue),
		executable: decision.executable,
		...(decision.provisoire === true ? { provisoire: true } : {}),
		home,
		...(decision.port === undefined ? {} : { port: decision.port }),
		async surTermine({ configuration, ouvrirALaSession }) {
			reglerOuvertureSession(ouvrirALaSession);
			// l'assistant fini ne se rouvre plus ; l'interface répond dès qu'elle est prête
			secondeOuverture = () => {};
			secondeOuverture = await demarrerInterface(contexte, home, images, configuration, paquet, true);
		},
		surAbandon: () => app.quit(),
	};
	secondeOuverture = () => void ouvrirAssistant(options);
	ouvrirAssistant(options);
}

/**
 * L'interface : suivi du service, barre des menus, fenêtre. `apresAssistant` : la fenêtre s'ouvre toujours (l'app n'a pas
 * été ouverte par l'ouverture de session). Rend la réponse à une seconde ouverture.
 */
async function demarrerInterface(
	contexte: ContexteApp,
	home: string,
	images: string,
	configurationLue: Configuration,
	paquet: Lancement | undefined,
	apresAssistant: boolean,
): Promise<() => void> {
	const { textes } = contexte;
	const configuration: Configuration = paquet === undefined ? configurationLue : { ...configurationLue, ...paquet };
	const lancement: Lancement = { node: configuration.node, main: configuration.main };
	const { racine } = configuration;
	const dossier = app.getPath('userData');
	const journal = journalFichier(cheminJournalApp(dossier));
	app.dock?.hide();
	const cheminPreferences = cheminPreferencesDe(dossier);
	const preferences = () => contexte.preferences.valeur();
	const retenir = (p: Parameters<PreferencesRetenues['retenir']>[0]): void => contexte.preferences.retenir(p);

	let quitteEnCours = false;
	/** La vérification au lancement (app empaquetée), tant qu'elle tourne : « Désinstaller Mnemo… » l'attend. */
	let verification: Promise<void> = Promise.resolve();
	/** L'app quitte (`before-quit`) : plus aucune boîte. */
	let enFermeture = false;
	const fenetre = creerFenetre({
		bornesRetenues: preferences().fenetre,
		retenirBornes: (b) => retenir({ fenetre: b }),
		surVisibilite(visible) {
			if (visible) void app.dock?.show();
			else app.dock?.hide();
		},
		// l'icône du Dock suit la couleur de l'interface : celle que la page redessine (PNG `data:`)
		surIconePage(adresses) {
			const adresse = iconeDockDeLaPage(adresses);
			if (adresse === null || app.dock === undefined) return;
			const image = nativeImage.createFromDataURL(adresse);
			if (!image.isEmpty()) app.dock.setIcon(image);
		},
		surLanguePage: (langue) => contexte.changerLangue(langue),
	});
	const suivi: SuiviService = creerSuivi({ acces: accesReel(configuration, { textes }), fenetreAuFocus: () => fenetre.auFocus(), textes });
	const notifications = new Set<Notification>();

	/** Montre la fenêtre (sur la session donnée) ; sans service, le démarre d'abord. */
	async function ouvrir(session?: string): Promise<void> {
		let service = suivi.instantane().service;
		if (service === null) {
			const vie = suivi.instantane().vie.etat;
			// en démarrage, `demarrer` attend celui en cours
			if (vie === 'arrete' || vie === 'erreur' || vie === 'demarrage') await suivi.demarrer();
			service = suivi.instantane().service;
		}
		if (service !== null) fenetre.montrer(service, session);
	}

	async function quitter(): Promise<void> {
		if (quitteEnCours) return;
		quitteEnCours = true;
		const i = suivi.instantane();
		let suite = suiteQuitter(preferences().quitter, i.vie.etat);
		if (suite === 'demander') {
			const r = await demanderQuitter(i.sessions ?? [], textes());
			if (r.retenir !== null) retenir({ quitter: r.retenir });
			if (r.suite === 'annuler') {
				quitteEnCours = false;
				return;
			}
			suite = r.suite;
		}
		if (suite === 'arreterPuisQuitter') {
			const r = await suivi.arreter();
			// quittée autrement pendant l'attente (fermeture de la session macOS) : aucune boîte qui la retiendrait
			if (enFermeture) return;
			if (!r.ok) {
				quitteEnCours = false;
				const t = textes();
				await direErreur(t.erreurs.arretService, t.erreurs.arretServiceQuitter(r.raison), t);
				return;
			}
		}
		app.quit();
	}

	/** Une fois par jour au plus (réglage actif) : la dernière version publiée, retenue pour le menu ; échec silencieux. */
	let rechercheEnCours = false;
	async function chercherVersion(): Promise<void> {
		if (rechercheEnCours || !verificationDue(preferences().chercherVersions, preferences().verificationVersionsMs, Date.now())) return;
		rechercheEnCours = true;
		try {
			const publiee = await derniereVersionPubliee();
			retenir({ verificationVersionsMs: Date.now(), ...(publiee === null ? {} : { versionPubliee: publiee }) });
			afficher(suivi.instantane());
		} finally {
			rechercheEnCours = false;
		}
	}

	/** Windows : le désinstalleur à ouvrir juste avant que l'app quitte (il ne retire pas une app encore ouverte). */
	let desinstalleurALancer: string | null = null;

	async function desinstaller(): Promise<void> {
		if (quitteEnCours) return;
		quitteEnCours = true;
		// la vérification au lancement, si elle tourne encore, finit d'abord : elle ne refait rien après les retraits
		await verification;
		const chemins = cheminsInstallation(home);
		// macOS : dossier personnel abrégé en `~` ; Windows : chemins en entier (`~` n'y dit rien)
		const abreger = (chemin: string): string => (PLATEFORME !== 'win32' && chemin.startsWith(`${home}${sep}`) ? `~${chemin.slice(home.length)}` : chemin);
		// macOS : le paquet `.app`, mis à la corbeille ; Windows : le désinstalleur, ouvert quand Mnemo quitte
		const cheminApp = PLATEFORME === 'win32' ? desinstalleurWindows(app.getPath('exe')) : paquetDeLApp(process.resourcesPath);
		const entree: EntreeDesinstallation = {
			plateforme: PLATEFORME,
			etat: lireEtatInstallation(home, lancement),
			ouvertureSession: lireOuvertureSession().openAtLogin,
			serviceVivant: suivi.instantane().vie.etat === 'vivant',
			empaquetee: app.isPackaged && cheminApp !== null,
			racine,
			chemins: { commande: abreger(chemins.commande), app: cheminApp ?? '', dossierApp: abreger(dossier) },
		};
		const t = textes();
		const notes = t.desinstallation.notes;
		const plan = planDesinstallation(entree, t);
		if (!(await demanderDesinstaller(plan))) {
			quitteEnCours = false;
			return;
		}
		const fichiers = actionsFichiers({ home, lancement, path: configuration.path, fichiersApp: [cheminConfiguration(home), cheminPreferences, cheminJournalApp(dossier)], textes: t });
		const resultats = await executerEtapes(plan.etapes, {
			...fichiers,
			async ouvertureSession() {
				reglerOuvertureSession(false);
			},
			async configuration() {
				// plus rien n'est écrit dans le dossier de l'app
				contexte.preferences.figer();
				return fichiers.configuration();
			},
			async service() {
				const r = await suivi.arreter();
				if (!r.ok) throw new Error(r.raison);
				if (r.force === true) return notes.arreteDeForce;
			},
			async corbeille() {
				if (cheminApp === null) throw new Error(notes.emplacementInconnu);
				// le service lancé depuis l'app (son Node) doit être arrêté avant qu'elle parte
				const vie = suivi.instantane().vie.etat;
				if (vie !== 'arrete' && vie !== 'erreur') throw new Error(notes.serviceCorbeille);
				await shell.trashItem(cheminApp);
			},
			async desinstalleur() {
				if (cheminApp === null) throw new Error(notes.desinstalleurIntrouvable);
				// le service lancé depuis l'app (son Node) tient ses fichiers ouverts : il doit être arrêté avant
				const vie = suivi.instantane().vie.etat;
				if (vie !== 'arrete' && vie !== 'erreur') throw new Error(notes.serviceDesinstalleur);
				desinstalleurALancer = cheminApp;
			},
		});
		await direBilan(bilanDesinstallation(resultats, entree, t), t);
		// Windows : le désinstalleur s'ouvre par le shell (`ShellExecute` : l'élévation demandée s'il le faut ; un échec rendu
		// en texte, jamais une exception), puis l'app quitte aussitôt pour qu'il la trouve fermée
		if (desinstalleurALancer !== null) {
			const chemin = desinstalleurALancer;
			const erreur = await shell.openPath(chemin).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
			if (erreur !== '') await direErreur(t.erreurs.desinstalleur, t.erreurs.desinstalleurDetail(chemin, erreur), t).catch(() => {});
		}
		app.quit();
	}

	/**
	 * « Reprendre le PATH du terminal » : relit le `PATH` du shell de connexion, remplace le seul champ `path` de
	 * `config.json` (et celui que reçoit le prochain démarrage du service), puis, service vivant, propose de le redémarrer.
	 * Shell illisible : rien n'est changé (le repli par défaut ne remplace jamais un `PATH` choisi).
	 */
	let reprisePathEnCours = false;
	async function reprendrePath(): Promise<void> {
		if (reprisePathEnCours || quitteEnCours) return;
		reprisePathEnCours = true;
		try {
			const lu = await lirePathTerminal({ home, journal });
			const t = textes();
			if (lu.origine === 'defaut') return await direErreur(t.erreurs.pathIllisible, t.erreurs.pathIllisibleDetail(lu.raison), t);
			if (lu.path === configuration.path) return await direInformation(t.erreurs.pathDeja, lu.path, t);
			try {
				await remplacerPathConfiguration(home, lu.path, paquet);
			} catch (e) {
				return await direErreur(t.erreurs.configurationNonModifiee, e instanceof Error ? e.message : String(e), t);
			}
			// l'objet que lit le démarrage du service (`accesReel`), la vérification et la désinstallation
			configuration.path = lu.path;
			journal(`PATH du terminal repris dans la configuration : ${lu.path}`);
			if (quitteEnCours || suivi.instantane().vie.etat !== 'vivant') return;
			if (!(await demanderRedemarrer(lu.path, textes()))) return;
			// pendant la question, le service a pu être arrêté depuis le menu, ou l'app commencer à quitter : rien n'est relancé
			if (quitteEnCours || suivi.instantane().vie.etat !== 'vivant') return;
			const r = await suivi.arreter();
			if (!r.ok) return await direErreur(textes().erreurs.arretService, r.raison, textes());
			// quitter ou désinstaller lancé pendant l'arrêt : le service ne repart pas
			if (quitteEnCours) return;
			await suivi.demarrer();
		} finally {
			reprisePathEnCours = false;
		}
	}

	async function action(a: ActionMenu): Promise<void> {
		switch (a.type) {
			case 'ouvrir':
				return ouvrir();
			case 'ouvrirSession':
				return ouvrir(a.session);
			case 'demarrerService':
				return suivi.demarrer();
			case 'arreterService': {
				const r = await suivi.arreter();
				const t = textes();
				if (!r.ok) await direErreur(t.erreurs.arretService, r.raison, t);
				else if (r.force === true) {
					journal('Service arrêté de force : la demande d’arrêt ne lui parvenait pas et il ne s’est pas arrêté seul (ses sessions n’ont pas été fermées proprement).');
					await direInformation(t.erreurs.arretForce, t.erreurs.arretForceDetail, t);
				}
				return;
			}
			case 'ouvertureSession':
				reglerOuvertureSession(a.active);
				afficher(suivi.instantane());
				return;
			case 'journal': {
				const erreur = await shell.openPath(cheminJournal(racine));
				if (erreur !== '') await direErreur(textes().erreurs.journal, erreur, textes());
				return;
			}
			case 'reprendrePath':
				return reprendrePath();
			case 'nouvelleVersion':
				// lien relu : une page de version du dépôt, rien d'autre
				if (estPageDeVersion(a.url)) await shell.openExternal(a.url);
				return;
			case 'chercherVersions':
				retenir({ chercherVersions: a.active });
				afficher(suivi.instantane());
				if (a.active) await chercherVersion();
				return;
			case 'desinstaller':
				return desinstaller();
			case 'quitter':
				return quitter();
		}
	}

	const barre = creerBarre({ plateforme: PLATEFORME, images: lireImagesBarre(images, toutesLesImages()), surAction: (a) => void action(a).catch((e: unknown) => journal(`Menu : ${e instanceof Error ? e.message : String(e)}`)) });
	const version = app.getVersion();

	function afficher(i: InstantaneSuivi): void {
		const p = preferences();
		const v = vueApp(
			i.vie,
			i.sessions,
			{
				plateforme: PLATEFORME,
				ouvertureSession: lireOuvertureSession().openAtLogin,
				version,
				// réglage coupé : plus rien n'est annoncé
				nouvelleVersion: p.chercherVersions ? versionAAnnoncer(version, p.versionPubliee) : null,
				chercherVersions: p.chercherVersions,
			},
			textes(),
		);
		barre.afficher(v.etat, v.infobulle, v.menu);
		app.dock?.setBadge(v.pastille);
	}

	suivi.surChangement((i) => {
		afficher(i);
		fenetre.serviceChange(i.service);
	});
	suivi.surNotification((n) => {
		if (!Notification.isSupported()) return;
		const notification = new Notification({ title: n.titre, body: n.corps });
		// gardée jusqu'au clic ou à la fermeture (sinon le ramasse-miettes peut emporter le clic)
		notifications.add(notification);
		notification.on('click', () => {
			notifications.delete(notification);
			void ouvrir(n.session);
		});
		notification.on('close', () => notifications.delete(notification));
		notification.show();
	});

	contexte.quitterParLeMenu(() => void quitter());
	// langue changée (interface, ou assistant juste avant) : la barre des menus est refaite
	contexte.surLangue(() => afficher(suivi.instantane()));
	app.on('activate', () => void ouvrir());
	// quitter autrement que par « Quitter Mnemo » (Dock, fermeture de la session macOS) : sans question, le service continue
	const examenVersion = setInterval(() => void chercherVersion(), INTERVALLE_EXAMEN_VERSION_MS);
	app.on('before-quit', () => {
		enFermeture = true;
		clearInterval(examenVersion);
		fenetre.quitter();
		suivi.fermer();
	});
	app.on('will-quit', () => barre.detruire());

	afficher(suivi.instantane());
	void chercherVersion();
	await suivi.ouvrir();
	const service = suivi.instantane().service;
	// app empaquetée : ce que Mnemo a installé pointe-t-il encore vers elle ? (arrière-plan, journal de l'app) ; jamais
	// depuis un emplacement provisoire (image disque, translocation) : tout pointerait vers un chemin bientôt disparu
	if (paquet !== undefined && emplacementProvisoire(process.resourcesPath)) {
		journal(`Vérification : app ouverte depuis un emplacement provisoire (${process.resourcesPath}) : rien n’est refait.`);
	} else if (paquet !== undefined && !quitteEnCours) {
		// (désinstallation ou départ déjà en cours : plus rien n'est refait)
		verification = verifierInstallation({ home, lancement: paquet, racine, path: configuration.path, service, journal }).then(
			() => {},
			(e: unknown) => journal(`Vérification : ${e instanceof Error ? e.message : String(e)}`),
		);
	}
	// ouverte à l'ouverture de session : seulement la barre des menus ; sinon la fenêtre, si le service répond
	if (service !== null && (apresAssistant || !ouverteParLaSession(process.argv, lireOuvertureSession().wasOpenedAtLogin))) fenetre.montrer(service);
	return () => void ouvrir();
}
