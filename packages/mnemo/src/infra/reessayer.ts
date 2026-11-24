import { setTimeout as attendre } from 'node:timers/promises';

/** Délais entre deux essais d'un renommage (ms) : 5 nouveaux essais, de 50 à 800 ms. */
export const DELAIS_RENOMMAGE: readonly number[] = [50, 100, 200, 400, 800];

/** Erreurs passagères sous Windows (antivirus, indexeur, Obsidian qui tient le fichier ouvert). */
const CODES_PASSAGERS = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** Exécute `action`, et la relance après chaque délai tant qu'elle échoue sur une erreur passagère. */
export async function reessayer<T>(action: () => Promise<T>, delais: readonly number[] = DELAIS_RENOMMAGE): Promise<T> {
	for (let essai = 0; ; essai++) {
		try {
			return await action();
		} catch (erreur) {
			const code = (erreur as NodeJS.ErrnoException).code;
			if (essai >= delais.length || code === undefined || !CODES_PASSAGERS.has(code)) throw erreur;
			await attendre(delais[essai]!);
		}
	}
}
