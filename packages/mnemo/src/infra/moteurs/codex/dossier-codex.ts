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
