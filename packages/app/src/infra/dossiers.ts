/**
 * Dossiers de l'app. Le dossier personnel est celui de `HOME` (`os.homedir()`), comme pour `pnpm installer-dev` qui écrit la
 * configuration, et non celui que macOS attribue au compte (`app.getPath('home')` ignore `HOME`) : un `HOME` temporaire
 * (essais) ne touche jamais au vrai dossier de l'app. Sous Windows, le dossier de l'app est sous `%APPDATA%` (essais : un
 * `APPDATA` de travail, ou sans `APPDATA`, sous `<dossier personnel>\AppData\Roaming`).
 */
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { dossierDonneesApp } from '@mnemo/commun';

export function dossierPersonnel(): string {
	return homedir();
}

/**
 * Dossier de l'app (celui de `config.json`) : `~/Library/Application Support/Mnemo` sous macOS, `%APPDATA%\Mnemo` sous
 * Windows (même règle que le dossier de l'app Claude, `@mnemo/commun`).
 */
export function dossierApp(home: string, plateforme: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
	return dossierDonneesApp(plateforme === 'win32' ? 'win32' : 'darwin', home, env, 'Mnemo');
}

/**
 * Dossier de données d'Electron pour l'essai (`MNEMO_APP_ESSAI=1`) : un dossier temporaire fixe, réutilisé d'un essai à
 * l'autre, pour qu'un essai de la construction n'écrive jamais dans le dossier de l'app installée. Il n'est pas retiré :
 * Chromium y écrit encore après la sortie du code de l'app.
 */
export function dossierEssai(): string {
	return join(tmpdir(), 'mnemo-app-essai');
}
