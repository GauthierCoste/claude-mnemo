import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CommandeMoteur } from '../../../application/ports.ts';
import { dossiersDuPath, estExecutable, estFichier } from '../executables.ts';

/**
 * Commande qui lance `vibe` (jamais par un shell). `MNEMO_VIBE` d'abord, et seul (un faux pour les tests, ou un binaire
 * choisi) : un `.mjs`/`.js` est lancé par le Node courant ; un fichier absent rend null. Sinon `vibe` dans le PATH (Windows :
 * `vibe.exe`), puis là où `uv tool install mistral-vibe` le pose (`~/.local/bin`, que le PATH d'une app de bureau n'a souvent
 * pas). Introuvable : null.
 */
export function trouverVibe(env: NodeJS.ProcessEnv, plateforme: NodeJS.Platform, accueil: string = homedir()): CommandeMoteur | null {
	const force = env.MNEMO_VIBE;
	if (force !== undefined && force !== '') {
		if (!estFichier(force)) return null;
		if (/\.(?:mjs|js)$/iu.test(force)) return { commande: process.execPath, avant: [force] };
		return { commande: force, avant: [] };
	}
	const noms = plateforme === 'win32' ? ['vibe.exe', 'vibe.EXE'] : ['vibe'];
	for (const dossier of [...dossiersDuPath(env, plateforme), join(accueil, '.local', 'bin')]) {
		for (const nom of noms) {
			const candidat = join(dossier, nom);
			if (estExecutable(candidat, plateforme)) return { commande: candidat, avant: [] };
		}
	}
	return null;
}
