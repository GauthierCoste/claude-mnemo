import { accessSync, constants, statSync } from 'node:fs';
import { variable } from '../environnement.ts';

export function estFichier(chemin: string): boolean {
	try {
		return statSync(chemin).isFile();
	} catch {
		return false;
	}
}

/** Un fichier que l'on peut lancer (Windows : tout fichier ; ailleurs, avec le droit d'exécution). */
export function estExecutable(chemin: string, plateforme: NodeJS.Platform): boolean {
	if (!estFichier(chemin)) return false;
	if (plateforme === 'win32') return true;
	try {
		accessSync(chemin, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/** Dossiers du PATH, sans entrées vides ; Windows : sans guillemets. */
export function dossiersDuPath(env: NodeJS.ProcessEnv, plateforme: NodeJS.Platform): string[] {
	const chemin = variable(env, 'PATH', plateforme) ?? '';
	return chemin
		.split(plateforme === 'win32' ? ';' : ':')
		.map((brut) => (plateforme === 'win32' ? brut.replace(/^"(.*)"$/u, '$1') : brut))
		.filter((d) => d !== '');
}
