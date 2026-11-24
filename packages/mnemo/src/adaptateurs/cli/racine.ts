import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DOSSIER_MEMOIRE } from '../../domaine/dossier-memoire.ts';

/** Premier dossier, en remontant depuis `depuis`, qui contient `_mnemo/SCHEMA.md` ; null sinon. */
export function trouverRacine(depuis: string): string | null {
	let courant = resolve(depuis);
	for (;;) {
		if (existsSync(join(courant, DOSSIER_MEMOIRE, 'SCHEMA.md'))) return courant;
		const parent = dirname(courant);
		if (parent === courant) return null;
		courant = parent;
	}
}

/**
 * Racine Mnemo d'une session et dossier du projet dont on tire la position : `CLAUDE_PROJECT_DIR` s'il est dans une
 * mémoire, sinon le dossier courant. Le projet est toujours le dossier qui a trouvé la racine (sinon `CLAUDE_PROJECT_DIR`
 * ou le dossier courant, sans racine).
 */
export function racineDeSession(projetDeClaude: string | undefined, dossierCourant: string): { racine: string | null; projet: string } {
	if (projetDeClaude) {
		const racine = trouverRacine(projetDeClaude);
		if (racine !== null) return { racine, projet: projetDeClaude };
	}
	const racine = trouverRacine(dossierCourant);
	if (racine !== null) return { racine, projet: dossierCourant };
	return { racine: null, projet: projetDeClaude || dossierCourant };
}
