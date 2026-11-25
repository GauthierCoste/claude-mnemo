import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { reglagesDansConfig } from '../../../domaine/moteurs/codex/declaration.ts';
import { dossierCodex } from './dossier-codex.ts';

/** Réglages de `[mcp_servers.mnemo]` dans `config.toml` de Codex, autres que `command` et `args`, lus seulement ; illisible : aucun. */
export async function reglagesMcpCodex(env: Record<string, string | undefined>): Promise<string[]> {
	try {
		return reglagesDansConfig(await readFile(join(dossierCodex(env), 'config.toml'), 'utf8'));
	} catch {
		return [];
	}
}
