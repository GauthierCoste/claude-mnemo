import { join } from 'node:path';
import type { CommandeMoteur } from '../../../application/ports.ts';
import { variable } from '../../environnement.ts';
import { dossiersDuPath, estExecutable, estFichier } from '../executables.ts';
import { cibleDuShim, SHIM } from '../shim-npm.ts';

/** Script du paquet npm de Claude Code, à côté de son shim. */
const PAQUET_CLAUDE = ['node_modules', '@anthropic-ai', 'claude-code', 'cli.js'];

/**
 * `claude<extension>` dans `dossier`, l'extension telle que `PATHEXT` l'écrit puis en minuscules : Windows ignore la casse,
 * un disque sensible à la casse (tests sous Linux) non. Null s'il n'y est pas.
 */
function fichierClaude(dossier: string, extension: string): string | null {
	for (const variante of new Set([extension, extension.toLowerCase()])) {
		const candidat = join(dossier, `claude${variante}`);
		if (estFichier(candidat)) return candidat;
	}
	return null;
}

/**
 * Commande qui lance `claude` (jamais par un shell) : `commande`, puis `avant`, puis les arguments de la session.
 * `MNEMO_CLAUDE` d'abord, et seul (un faux pour les tests, ou un binaire choisi) : un `.mjs`/`.js` est lancé par le Node
 * courant ; un fichier absent rend null, sans retomber sur le `claude` du PATH. Sinon `claude` est cherché dans le PATH.
 * Windows : `claude.exe` d'abord, dans tout le PATH ; puis les autres extensions de `PATHEXT`, un `.cmd`/`.bat` étant
 * remplacé par sa cible (`cibleDuShim`). Introuvable : null.
 */
export function trouverClaude(env: NodeJS.ProcessEnv, plateforme: NodeJS.Platform): CommandeMoteur | null {
	const force = env.MNEMO_CLAUDE;
	if (force !== undefined && force !== '') {
		if (!estFichier(force)) return null;
		if (/\.(?:mjs|js)$/iu.test(force)) return { commande: process.execPath, avant: [force] };
		if (plateforme === 'win32' && SHIM.test(force)) return cibleDuShim(force, PAQUET_CLAUDE);
		return { commande: force, avant: [] };
	}
	const dossiers = dossiersDuPath(env, plateforme);
	if (plateforme !== 'win32') {
		for (const dossier of dossiers) {
			const candidat = join(dossier, 'claude');
			if (estExecutable(candidat, plateforme)) return { commande: candidat, avant: [] };
		}
		return null;
	}
	const extensions = (variable(env, 'PATHEXT', plateforme) ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((e) => e !== '');
	const exe = extensions.filter((e) => e.toLowerCase() === '.exe');
	for (const dossier of dossiers) {
		for (const extension of exe.length > 0 ? exe : ['.exe']) {
			const candidat = fichierClaude(dossier, extension);
			if (candidat !== null) return { commande: candidat, avant: [] };
		}
	}
	for (const dossier of dossiers) {
		for (const extension of extensions) {
			if (extension.toLowerCase() === '.exe') continue;
			const candidat = fichierClaude(dossier, extension);
			if (candidat === null) continue;
			if (!SHIM.test(candidat)) return { commande: candidat, avant: [] };
			const cible = cibleDuShim(candidat, PAQUET_CLAUDE);
			if (cible !== null) return cible;
		}
	}
	return null;
}
