import { realpathSync } from 'node:fs';

/**
 * Chemin de Node à écrire là où il doit survivre à ce processus (déclaration MCP, hooks des plugins, commande de démarrage).
 * Sous Windows, liens résolus : fnm lance Node par un lien propre au shell (`fnm_multishells\<id>\node.exe`), effacé à sa
 * fermeture. Ailleurs, `process.execPath` est déjà résolu par Node.
 */
export function nodeDurable(plateforme: NodeJS.Platform = process.platform, execPath: string = process.execPath, resoudre: (chemin: string) => string = realpathSync.native): string {
	if (plateforme !== 'win32') return execPath;
	try {
		return resoudre(execPath);
	} catch {
		return execPath;
	}
}
