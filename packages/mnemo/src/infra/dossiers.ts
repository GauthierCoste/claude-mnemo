/** Les dossiers sous la racine du dossier Mnemo, lus sur le disque sans suivre de lien symbolique. */
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { DossiersRacine } from '../application/ports.ts';

/** Motif lisible d'un échec de lecture (code de `node:fs`), sans le chemin absolu. */
function motif(erreur: unknown): string {
	const code = (erreur as NodeJS.ErrnoException).code;
	if (code === 'ENOENT') return 'introuvable';
	if (code === 'ENOTDIR') return "ce n'est pas un dossier";
	if (code === 'EACCES' || code === 'EPERM') return 'lecture refusée';
	return erreur instanceof Error ? erreur.message : String(erreur);
}

export function dossiersRacine(racine: string): DossiersRacine {
	return {
		async lire(chemin) {
			let absolu = racine;
			try {
				for (const segment of chemin === '' ? [] : chemin.split('/')) {
					absolu = join(absolu, segment);
					// un lien pourrait mener hors de la racine : il n'est ni listé ni déplié
					if ((await lstat(absolu)).isSymbolicLink()) throw new Error('lien symbolique');
				}
				const entrees = await readdir(absolu, { withFileTypes: true });
				return { dossiers: entrees.filter((e) => e.isDirectory()).map((e) => e.name), entrees: entrees.map((e) => e.name) };
			} catch (erreur) {
				throw new Error(motif(erreur));
			}
		},
	};
}
