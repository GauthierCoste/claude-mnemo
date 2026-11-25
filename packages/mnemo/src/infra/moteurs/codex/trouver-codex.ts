import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CommandeMoteur } from '../../../application/ports.ts';
import { dossiersDuPath, estExecutable, estFichier } from '../executables.ts';
import { cibleDuShim, SHIM } from '../shim-npm.ts';

/** Exécutable de Codex fourni avec l'app ChatGPT (macOS). */
export const CODEX_DE_CHATGPT = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';

/** Script du paquet npm de Codex (`@openai/codex`), à côté de son shim. */
const PAQUET_CODEX = ['node_modules', '@openai', 'codex', 'bin', 'codex.js'];

/**
 * Le `codex` du bundle de ChatGPT (`codex-cli/bin/codex`) est un script shell qui lance l'exécutable du bundle : jamais
 * rendu, l'exécutable `CodexCLI.app/Contents/MacOS/codex` à sa place, ou null s'il manque. Tout autre chemin : tel quel.
 */
function sansScriptDuBundle(chemin: string): string | null {
	let reel: string;
	try {
		reel = realpathSync.native(chemin);
	} catch {
		return chemin;
	}
	if (!/[\\/]codex-cli[\\/]bin[\\/]codex$/u.test(reel)) return chemin;
	const executable = join(dirname(dirname(reel)), 'CodexCLI.app', 'Contents', 'MacOS', 'codex');
	return estFichier(executable) ? executable : null;
}

/** Windows : `codex.exe` d'abord dans tout le PATH, puis un shim npm `codex.cmd` remplacé par sa cible. */
function trouverSousWindows(dossiers: string[]): CommandeMoteur | null {
	for (const dossier of dossiers) {
		for (const nom of ['codex.exe', 'codex.EXE']) {
			const candidat = join(dossier, nom);
			if (estFichier(candidat)) return { commande: candidat, avant: [] };
		}
	}
	for (const dossier of dossiers) {
		for (const nom of ['codex.cmd', 'codex.CMD']) {
			const candidat = join(dossier, nom);
			if (!estFichier(candidat)) continue;
			const cible = cibleDuShim(candidat, PAQUET_CODEX);
			if (cible !== null) return cible;
		}
	}
	return null;
}

/**
 * Commande qui lance `codex` (jamais par un shell). `MNEMO_CODEX` d'abord, et seul (un faux pour les tests, ou un binaire
 * choisi) : un `.mjs`/`.js` est lancé par le Node courant, un shim `.cmd` (Windows) remplacé par sa cible ; un fichier
 * absent rend null. Sinon `codex` dans le PATH (Windows : `codex.exe`, puis le shim npm `codex.cmd`) ; puis, sous macOS,
 * l'exécutable de ChatGPT.app (`bundle`). Le script shell du bundle n'est jamais rendu. Introuvable : null.
 */
export function trouverCodex(env: NodeJS.ProcessEnv, plateforme: NodeJS.Platform, bundle: string = CODEX_DE_CHATGPT): CommandeMoteur | null {
	const force = env.MNEMO_CODEX;
	if (force !== undefined && force !== '') {
		if (!estFichier(force)) return null;
		if (/\.(?:mjs|js)$/iu.test(force)) return { commande: process.execPath, avant: [force] };
		if (plateforme === 'win32' && SHIM.test(force)) return cibleDuShim(force, PAQUET_CODEX);
		const commande = sansScriptDuBundle(force);
		return commande === null ? null : { commande, avant: [] };
	}
	const dossiers = dossiersDuPath(env, plateforme);
	if (plateforme === 'win32') return trouverSousWindows(dossiers);
	for (const dossier of dossiers) {
		const candidat = join(dossier, 'codex');
		if (!estExecutable(candidat, plateforme)) continue;
		const commande = sansScriptDuBundle(candidat);
		if (commande !== null) return { commande, avant: [] };
	}
	if (plateforme === 'darwin' && estExecutable(bundle, plateforme)) return { commande: bundle, avant: [] };
	return null;
}
