import { realpathSync } from 'node:fs';

/**
 * Sous Windows, le chemin tel qu'il est sur le disque (casse réelle, liens résolus) : un `cd c:\…\clients\acme` garde la casse
 * tapée, et le projet ne correspondrait pas au dossier `Clients/Acme` de la mémoire. Ailleurs, ou s'il n'existe pas : inchangé.
 */
export function cheminReel(chemin: string, plateforme: NodeJS.Platform = process.platform, resoudre: (chemin: string) => string = realpathSync.native): string {
	if (plateforme !== 'win32') return chemin;
	try {
		return resoudre(chemin);
	} catch {
		return chemin;
	}
}
