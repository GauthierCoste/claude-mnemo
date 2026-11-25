import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CommandeMoteur } from '../../../application/ports.ts';
import { variable } from '../../environnement.ts';

function estFichier(chemin: string): boolean {
	try {
		return statSync(chemin).isFile();
	} catch {
		return false;
	}
}

function estExecutable(chemin: string, plateforme: NodeJS.Platform): boolean {
	if (!estFichier(chemin)) return false;
	if (plateforme === 'win32') return true;
	try {
		accessSync(chemin, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

const SHIM = /\.(?:cmd|bat)$/iu;

/** Cibles citées par un shim npm : `"%dp0%\chemin\cli.js"` (ou `%~dp0`), chemins relatifs au dossier du shim. */
function ciblesDuShim(texte: string): string[] {
	return [...texte.matchAll(/"%~?dp0%?[\\/]*([^"%*]+?\.(?:mjs|cjs|js|exe))"/giu)].map((m) => m[1]!);
}

/**
 * Windows : un `claude.cmd` (shim npm) ne se lance pas sans shell. On lance sa cible à la place : un script Node par le Node
 * courant, un exécutable natif directement (jamais `node.exe`, l'interpréteur du shim) ; à défaut le `cli.js` du paquet
 * `@anthropic-ai/claude-code` à côté du shim. Rien de trouvé : null (mode dégradé, ligne de commande manuelle).
 */
function cibleDuShim(shim: string): CommandeMoteur | null {
	const dossier = dirname(shim);
	let texte = '';
	try {
		texte = readFileSync(shim, 'utf8');
	} catch {
		texte = '';
	}
	const cibles = ciblesDuShim(texte).map((relatif) => join(dossier, ...relatif.split(/[\\/]/u).filter((s) => s !== '')));
	const scripts = cibles.filter((c) => /\.(?:mjs|cjs|js)$/iu.test(c));
	const natifs = cibles.filter((c) => /\.exe$/iu.test(c) && !/(?:^|[\\/])node\.exe$/iu.test(c));
	for (const script of scripts) if (estFichier(script)) return { commande: process.execPath, avant: [script] };
	for (const natif of natifs) if (estFichier(natif)) return { commande: natif, avant: [] };
	const paquet = join(dossier, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
	return estFichier(paquet) ? { commande: process.execPath, avant: [paquet] } : null;
}

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

/** Windows : dossiers du PATH, sans guillemets ni entrées vides. */
function dossiersDuPath(env: NodeJS.ProcessEnv, plateforme: NodeJS.Platform): string[] {
	const chemin = variable(env, 'PATH', plateforme) ?? '';
	return chemin
		.split(plateforme === 'win32' ? ';' : ':')
		.map((brut) => (plateforme === 'win32' ? brut.replace(/^"(.*)"$/u, '$1') : brut))
		.filter((d) => d !== '');
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
		if (plateforme === 'win32' && SHIM.test(force)) return cibleDuShim(force);
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
			const cible = cibleDuShim(candidat);
			if (cible !== null) return cible;
		}
	}
	return null;
}
