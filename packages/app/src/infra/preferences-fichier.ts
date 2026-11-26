/**
 * Fichier des préférences de l'app (`preferences.json` dans le dossier de l'app, 0600), lu au démarrage et réécrit à chaque
 * changement (fichier temporaire puis renommage : jamais à moitié écrit). Illisible : les valeurs par défaut.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { lirePreferences, type Preferences } from '../domaine/preferences.ts';

export const FICHIER_PREFERENCES = 'preferences.json';

/** `preferences.json` du dossier de données de l'app. */
export function cheminPreferences(dossier: string): string {
	return join(dossier, FICHIER_PREFERENCES);
}

export function lirePreferencesFichier(chemin: string): Preferences {
	let brut: unknown = null;
	try {
		brut = JSON.parse(readFileSync(chemin, 'utf8'));
	} catch {
		// absent, illisible ou abîmé : valeurs par défaut
	}
	return lirePreferences(brut);
}

export function ecrirePreferencesFichier(chemin: string, preferences: Preferences): void {
	mkdirSync(dirname(chemin), { recursive: true, mode: 0o700 });
	const temporaire = `${chemin}.${process.pid}.tmp`;
	writeFileSync(temporaire, `${JSON.stringify(preferences, null, '\t')}\n`, { mode: 0o600 });
	renameSync(temporaire, chemin);
}
