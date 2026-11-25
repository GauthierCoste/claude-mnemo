import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CommandeMoteur } from '../../../application/ports.ts';
import { dossiersDuPath, estExecutable, estFichier } from '../executables.ts';

/** Exécutable de Codex fourni avec l'app ChatGPT (macOS). */
export const CODEX_DE_CHATGPT = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';

/**
 * Le `codex` du bundle de ChatGPT (`codex-cli/bin/codex`) est un script shell qui lance l'exécutable du bundle : on lance
 * celui-ci directement. Tout autre chemin est rendu tel quel.
 */
function sansScriptDuBundle(chemin: string): string {
	let reel = chemin;
	try {
		reel = realpathSync.native(chemin);
	} catch {
		return chemin;
	}
	if (!/[\\/]codex-cli[\\/]bin[\\/]codex$/u.test(reel)) return chemin;
	const executable = join(dirname(dirname(reel)), 'CodexCLI.app', 'Contents', 'MacOS', 'codex');
	return estFichier(executable) ? executable : chemin;
}

/**
 * Commande qui lance `codex` (jamais par un shell). `MNEMO_CODEX` d'abord, et seul (un faux pour les tests, ou un binaire
 * choisi) : un `.mjs`/`.js` est lancé par le Node courant ; un fichier absent rend null. Sinon `codex` dans le PATH
 * (Windows : `codex.exe` seulement, un `.cmd` demandant un shell) ; puis, sous macOS, l'exécutable de ChatGPT.app
 * (`bundle`). Introuvable : null.
 */
export function trouverCodex(env: NodeJS.ProcessEnv, plateforme: NodeJS.Platform, bundle: string = CODEX_DE_CHATGPT): CommandeMoteur | null {
	const force = env.MNEMO_CODEX;
	if (force !== undefined && force !== '') {
		if (!estFichier(force)) return null;
		if (/\.(?:mjs|js)$/iu.test(force)) return { commande: process.execPath, avant: [force] };
		if (plateforme === 'win32' && /\.(?:cmd|bat)$/iu.test(force)) return null;
		return { commande: force, avant: [] };
	}
	const dossiers = dossiersDuPath(env, plateforme);
	if (plateforme === 'win32') {
		for (const dossier of dossiers) {
			for (const nom of ['codex.exe', 'codex.EXE']) {
				const candidat = join(dossier, nom);
				if (estFichier(candidat)) return { commande: candidat, avant: [] };
			}
		}
		return null;
	}
	for (const dossier of dossiers) {
		const candidat = join(dossier, 'codex');
		if (estExecutable(candidat, plateforme)) return { commande: sansScriptDuBundle(candidat), avant: [] };
	}
	if (plateforme === 'darwin' && estExecutable(bundle, plateforme)) return { commande: bundle, avant: [] };
	return null;
}
