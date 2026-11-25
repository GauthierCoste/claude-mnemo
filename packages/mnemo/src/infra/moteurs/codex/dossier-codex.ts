import { homedir } from 'node:os';
import { join } from 'node:path';

/** Dossier de configuration de Codex : `$CODEX_HOME`, sinon `~/.codex`. */
export function dossierCodex(env: Record<string, string | undefined>): string {
	return env.CODEX_HOME !== undefined && env.CODEX_HOME !== '' ? env.CODEX_HOME : join(homedir(), '.codex');
}
