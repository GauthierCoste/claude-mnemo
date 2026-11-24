/**
 * Fichier de configuration de l'app Claude (Claude Desktop) : son chemin selon la plateforme, sa lecture (sans jamais lever)
 * et son écriture atomique (fichier provisoire à côté, puis renommé ; droits 0600 : il porte souvent des clés d'API).
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, posix, win32 } from 'node:path';

export const NOM_FICHIER_CLAUDE_DESKTOP = 'claude_desktop_config.json';

/**
 * Chemin du fichier : macOS `~/Library/Application Support/Claude/`, Windows `%APPDATA%\Claude\` (à défaut
 * `~\AppData\Roaming\Claude\`), ailleurs `$XDG_CONFIG_HOME/Claude/` (à défaut `~/.config/Claude/`).
 */
export function fichierConfigClaudeDesktop(plateforme: NodeJS.Platform, maison: string, env: Readonly<Record<string, string | undefined>>): string {
	if (plateforme === 'win32') {
		const appData = env['APPDATA'] || win32.join(maison, 'AppData', 'Roaming');
		return win32.join(appData, 'Claude', NOM_FICHIER_CLAUDE_DESKTOP);
	}
	if (plateforme === 'darwin') return posix.join(maison, 'Library', 'Application Support', 'Claude', NOM_FICHIER_CLAUDE_DESKTOP);
	const config = env['XDG_CONFIG_HOME'] || posix.join(maison, '.config');
	return posix.join(config, 'Claude', NOM_FICHIER_CLAUDE_DESKTOP);
}

/**
 * Lecture : `installee` faux si le dossier de l'app Claude n'existe pas ; `texte` null si le fichier est absent ; `erreur`
 * s'il ne se lit pas (droits, dossier à sa place…).
 */
export type LectureClaudeDesktop = { installee: false } | { installee: true; texte: string | null } | { installee: true; erreur: string };

const estDossier = (chemin: string): boolean => {
	try {
		return statSync(chemin).isDirectory();
	} catch {
		return false;
	}
};

export function lireFichierClaudeDesktop(fichier: string): LectureClaudeDesktop {
	if (!estDossier(dirname(fichier))) return { installee: false };
	try {
		return { installee: true, texte: readFileSync(fichier, 'utf8') };
	} catch (erreur) {
		if ((erreur as NodeJS.ErrnoException).code === 'ENOENT') return { installee: true, texte: null };
		return { installee: true, erreur: `Fichier illisible (${(erreur as Error).message}).` };
	}
}

/** Écrit `texte` à la place du fichier : provisoire 0600 dans le même dossier, puis renommé ; rien n'est laissé en échec. */
export function ecrireFichierClaudeDesktop(fichier: string, texte: string): void {
	const provisoire = join(dirname(fichier), `.${basename(fichier)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
	try {
		writeFileSync(provisoire, texte, { mode: 0o600, flag: 'wx' });
		renameSync(provisoire, fichier);
	} catch (erreur) {
		rmSync(provisoire, { force: true });
		throw erreur;
	}
}
