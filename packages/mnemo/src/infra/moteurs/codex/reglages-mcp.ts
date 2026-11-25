import { reglagesDansConfig } from '../../../domaine/moteurs/codex/declaration.ts';
import { lireConfigCodex } from './dossier-codex.ts';

/** Réglages de `[mcp_servers.mnemo]` dans `config.toml` de Codex, autres que `command` et `args`, lus seulement ; absent ou illisible : aucun. */
export async function reglagesMcpCodex(env: Record<string, string | undefined>): Promise<string[]> {
	try {
		return reglagesDansConfig((await lireConfigCodex(env)) ?? '');
	} catch {
		return [];
	}
}
