import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

/**
 * Dossier de configuration de Codex : `$CODEX_HOME` s'il est un chemin absolu, sinon `~/.codex` (un chemin relatif dépendrait
 * du dossier courant de chaque processus : ignoré).
 */
export function dossierCodex(env: Record<string, string | undefined>): string {
	const home = env.CODEX_HOME;
	return home !== undefined && home !== '' && isAbsolute(home) ? home : join(homedir(), '.codex');
}

/** `config.toml` de Codex : `$CODEX_HOME/config.toml`, sinon `~/.codex/config.toml`. */
export const cheminConfigCodex = (env: Record<string, string | undefined>): string => join(dossierCodex(env), 'config.toml');

/** Texte de `config.toml` de Codex, lu seulement (jamais écrit par Mnemo) ; null s'il n'existe pas ; une autre erreur remonte. */
export async function lireConfigCodex(env: Record<string, string | undefined>): Promise<string | null> {
	try {
		return await readFile(cheminConfigCodex(env), 'utf8');
	} catch (erreur) {
		if ((erreur as { code?: string }).code === 'ENOENT') return null;
		throw erreur;
	}
}
