import { mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import lockfile from 'proper-lockfile';
import type { Verrou } from '../application/ports.ts';

/** Attente du verrou : délais croissants (25 ms, ×1,5, 500 ms au plus), une trentaine de secondes en tout (au moins 30 s). */
export const ATTENTE_PAR_DEFAUT = { essais: 65, delaiMin: 25, facteur: 1.5, delaiMax: 500 };

export const MEMOIRE_OCCUPEE = 'Mémoire occupée par une autre écriture : réessayer dans un instant.';

/** `creerDossier: false` : le dossier du verrou n'est jamais créé (absent : le verrou échoue, ENOENT). */
export function verrouFichier(fichierVerrou: string, attente: Partial<typeof ATTENTE_PAR_DEFAUT> & { creerDossier?: boolean } = {}): Verrou {
	const { essais, delaiMin, facteur, delaiMax, creerDossier } = { ...ATTENTE_PAR_DEFAUT, creerDossier: true, ...attente };
	return {
		async avec(action) {
			if (creerDossier) await mkdir(dirname(fichierVerrou), { recursive: true });
			// proper-lockfile verrouille un fichier existant : on le crée vide au besoin.
			await (await open(fichierVerrou, 'a')).close();
			let liberer: () => Promise<void>;
			try {
				liberer = await lockfile.lock(fichierVerrou, {
					// Délais tirés au hasard (×1 à ×2) : des écritures concurrentes ne réessaient pas toutes au même instant.
					retries: { retries: essais, minTimeout: delaiMin, factor: facteur, maxTimeout: delaiMax, randomize: true },
					stale: 10000,
				});
			} catch (erreur) {
				if ((erreur as NodeJS.ErrnoException).code === 'ELOCKED') throw new Error(MEMOIRE_OCCUPEE, { cause: erreur });
				throw erreur;
			}
			try {
				return await action();
			} finally {
				await liberer();
			}
		},
	};
}
