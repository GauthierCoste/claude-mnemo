import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

/**
 * Dossier de configuration d'un moteur : la variable `variable` (`CODEX_HOME`, `VIBE_HOME`) si elle donne un chemin absolu
 * (`~/…` développé quand `tilde` : le moteur le fait lui-même), sinon `~/<parDefaut>`. Un chemin relatif dépendrait du dossier
 * courant de chaque processus : ignoré.
 */
export function dossierDuMoteur(env: Record<string, string | undefined>, variable: string, parDefaut: string, tilde = false): string {
	const brut = env[variable];
	const valeur = tilde && brut !== undefined && /^~(?:[\\/]|$)/u.test(brut) ? join(homedir(), brut.slice(1)) : brut;
	return valeur !== undefined && valeur !== '' && isAbsolute(valeur) ? valeur : join(homedir(), parDefaut);
}
