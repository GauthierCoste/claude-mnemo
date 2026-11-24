import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PAQUET = new URL('../../package.json', import.meta.url);

/** Version déclarée dans `paquet` ; erreur si le fichier ou son champ `version` est illisible (il fait partie du code livré). */
export function lireVersion(paquet: URL): string {
	let v: unknown;
	try {
		v = (JSON.parse(readFileSync(paquet, 'utf8')) as { version?: unknown }).version;
	} catch {
		v = undefined;
	}
	if (typeof v !== 'string' || v === '') throw new Error(`Version de Mnemo illisible dans ${fileURLToPath(paquet)}.`);
	return v;
}

/** Version de Mnemo (`packages/mnemo/package.json`). */
export const versionMnemo = (): string => lireVersion(PAQUET);
