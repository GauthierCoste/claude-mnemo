import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CommandeMoteur } from '../../../application/ports.ts';
import { dossiersDuPath, estExecutable, estFichier } from '../executables.ts';
import { cibleDuShim, SHIM } from '../shim-npm.ts';
import { trouverSousWindows } from '../trouver-sous-windows.ts';

/** Script du paquet npm de Copilot (`@github/copilot`), à côté de son shim. */
const PAQUET_COPILOT = ['node_modules', '@github', 'copilot', 'npm-loader.js'];

/** Dossiers usuels de `copilot` hors du PATH (celui d'une app de bureau est souvent réduit) : Homebrew, npm global de l'utilisateur. */
const dossiersUsuels = (accueil: string): string[] => ['/opt/homebrew/bin', '/usr/local/bin', join(accueil, '.npm-global', 'bin')];

/**
 * Commande qui lance `copilot` (jamais par un shell). `MNEMO_COPILOT` d'abord, et seul (un faux pour les tests, ou un binaire
 * choisi) : un `.mjs`/`.js` est lancé par le Node courant, un shim `.cmd` (Windows) remplacé par sa cible ; un fichier absent
 * rend null. Sinon `copilot` dans le PATH, puis dans les dossiers de Homebrew et de npm global (`~/.npm-global/bin`) ;
 * Windows : `copilot.exe`, puis le shim npm `copilot.cmd`, dans le PATH puis `%APPDATA%\npm`. Introuvable : null.
 */
export function trouverCopilot(env: NodeJS.ProcessEnv, plateforme: NodeJS.Platform, accueil: string = homedir()): CommandeMoteur | null {
	const force = env.MNEMO_COPILOT;
	if (force !== undefined && force !== '') {
		if (!estFichier(force)) return null;
		if (/\.(?:mjs|js)$/iu.test(force)) return { commande: process.execPath, avant: [force] };
		if (plateforme === 'win32' && SHIM.test(force)) return cibleDuShim(force, PAQUET_COPILOT);
		return { commande: force, avant: [] };
	}
	const dossiers = dossiersDuPath(env, plateforme);
	if (plateforme === 'win32') {
		const appdata = env.APPDATA;
		return trouverSousWindows('copilot', appdata === undefined || appdata === '' ? dossiers : [...dossiers, join(appdata, 'npm')], PAQUET_COPILOT);
	}
	for (const dossier of [...dossiers, ...dossiersUsuels(accueil)]) {
		const candidat = join(dossier, 'copilot');
		if (estExecutable(candidat, plateforme)) return { commande: candidat, avant: [] };
	}
	return null;
}
