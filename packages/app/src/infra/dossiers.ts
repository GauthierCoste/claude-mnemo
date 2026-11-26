/**
 * Dossiers de l'app. Le dossier personnel est celui de `HOME` (`os.homedir()`), comme pour `pnpm installer-dev` qui écrit la
 * configuration, et non celui que macOS attribue au compte (`app.getPath('home')` ignore `HOME`) : un `HOME` temporaire
 * (essais) ne touche jamais au vrai dossier de l'app. Sous Windows, les dossiers de données sont sous `%APPDATA%` : pour
 * le vrai dossier personnel, celui du système ; pour un autre (essais, tests), `<ce dossier>\AppData\Roaming`, jamais le
 * vrai `%APPDATA%` (`environnementDuDossier`).
 */
import { homedir, tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { dossierDonneesApp } from '@mnemo/commun';
import { plateformeApp } from '../domaine/plateforme.ts';

export function dossierPersonnel(): string {
	return homedir();
}

/**
 * Environnement d'où lire les dossiers de données sous le dossier personnel `home` : celui du processus pour le vrai
 * dossier personnel (`personnel`, `os.homedir()`) ; pour un autre sous Windows, `APPDATA` en est dérivé
 * (`<home>\AppData\Roaming`), pour qu'un dossier personnel de travail ne touche jamais au vrai `%APPDATA%`.
 */
export function environnementDuDossier(home: string, plateforme: NodeJS.Platform = process.platform, base: NodeJS.ProcessEnv = process.env, personnel: string = homedir()): NodeJS.ProcessEnv {
	if (plateforme !== 'win32' || home === personnel) return base;
	return { ...base, APPDATA: win32.join(home, 'AppData', 'Roaming') };
}

/**
 * Dossier de l'app (celui de `config.json`) : `~/Library/Application Support/Mnemo` sous macOS, `%APPDATA%\Mnemo` sous
 * Windows (même règle que le dossier de l'app Claude, `@mnemo/commun` ; `env` : par défaut `environnementDuDossier`).
 */
export function dossierApp(home: string, plateforme: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = environnementDuDossier(home, plateforme)): string {
	return dossierDonneesApp(plateformeApp(plateforme), home, env, 'Mnemo');
}

/**
 * Dossier de données d'Electron pour l'essai (`MNEMO_APP_ESSAI=1`) : un dossier temporaire fixe, réutilisé d'un essai à
 * l'autre, pour qu'un essai de la construction n'écrive jamais dans le dossier de l'app installée. Il n'est pas retiré :
 * Chromium y écrit encore après la sortie du code de l'app.
 */
export function dossierEssai(): string {
	return join(tmpdir(), 'mnemo-app-essai');
}
