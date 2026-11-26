/**
 * Dossiers de l'app. Le dossier personnel est celui de `HOME` (`os.homedir()`), comme pour `pnpm installer-dev` qui écrit la
 * configuration, et non celui que macOS attribue au compte (`app.getPath('home')` ignore `HOME`) : un `HOME` temporaire
 * (essais) ne touche jamais au vrai dossier de l'app.
 */
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export function dossierPersonnel(): string {
	return homedir();
}

/** Dossier de l'app sous le dossier personnel (celui de `config.json`) : `~/Library/Application Support/Mnemo`. */
export function dossierApp(home: string): string {
	return join(home, 'Library', 'Application Support', 'Mnemo');
}

/**
 * Dossier de données d'Electron pour l'essai (`MNEMO_APP_ESSAI=1`) : un dossier temporaire fixe, réutilisé d'un essai à
 * l'autre, pour qu'un essai de la construction n'écrive jamais dans le dossier de l'app installée. Il n'est pas retiré :
 * Chromium y écrit encore après la sortie du code de l'app.
 */
export function dossierEssai(): string {
	return join(tmpdir(), 'mnemo-app-essai');
}
