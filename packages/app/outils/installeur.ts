/**
 * Installeur Windows (`pnpm construire-app --installeur`, sous Windows) : electron-builder sur le dossier déjà assemblé par
 * `@electron/packager` (`--prepackaged` : rien n'est refait ni modifié dans l'app), cible NSIS à étapes : choix pour
 * l'utilisateur seul ou pour tous (par défaut : l'utilisateur, sans droits d'administrateur), dossier d'installation
 * modifiable, raccourcis du menu Démarrer et du bureau, désinstalleur inscrit dans les paramètres de Windows. Ni signature,
 * ni mise à jour automatique, ni publication.
 */
import { Arch, build, type Configuration, Platform } from 'electron-builder';
import { IDENTIFIANT_APP, NOM_APP } from '../src/domaine/identite-app.ts';
import { ErreurConstruction } from './erreur.ts';

/** Nom de l'installeur : `Mnemo-Setup-1.8.0-x64.exe`. */
export function nomInstalleur(version: string): string {
	return `${NOM_APP}-Setup-${version}-x64.exe`;
}

/** Configuration d'electron-builder ; `icone` : le `.ico` de l'app, `sortie` : le dossier où écrire l'installeur. */
export function configurationInstalleur(version: string, electron: string, icone: string, sortie: string): Configuration {
	return {
		appId: IDENTIFIANT_APP,
		productName: NOM_APP,
		copyright: NOM_APP,
		electronVersion: electron,
		directories: { output: sortie },
		npmRebuild: false,
		nodeGypRebuild: false,
		publish: null,
		win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: icone, signAndEditExecutable: false },
		nsis: {
			oneClick: false,
			perMachine: false,
			allowToChangeInstallationDirectory: true,
			createDesktopShortcut: true,
			createStartMenuShortcut: true,
			shortcutName: NOM_APP,
			uninstallDisplayName: NOM_APP,
			installerIcon: icone,
			uninstallerIcon: icone,
			artifactName: nomInstalleur(version),
			differentialPackage: false,
		},
	};
}

/**
 * Construit l'installeur du dossier `produit` (sortie de `@electron/packager`) ; `projet` : un dossier dont le
 * `package.json` donne nom et version. Rend le chemin de l'installeur.
 */
export async function creerInstalleur(produit: string, projet: string, version: string, electron: string, icone: string, sortie: string): Promise<string> {
	const fichiers = await build({
		targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
		prepackaged: produit,
		projectDir: projet,
		config: configurationInstalleur(version, electron, icone, sortie),
		publish: 'never',
	});
	const installeur = fichiers.find((f) => f.endsWith(nomInstalleur(version)));
	if (installeur === undefined) throw new ErreurConstruction(`electron-builder n’a pas produit ${nomInstalleur(version)} (${fichiers.join(', ')}).`);
	return installeur;
}
