import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DOSSIER_MEMOIRE } from '../../domaine/dossier-memoire.ts';

/** Premier dossier, en remontant depuis `depuis`, qui contient `_mnemo/SCHEMA.md` ; null sinon. */
export function trouverRacine(depuis: string): string | null {
	let courant = resolve(depuis);
	for (;;) {
		if (estRacine(courant)) return courant;
		const parent = dirname(courant);
		if (parent === courant) return null;
		courant = parent;
	}
}

/** Vrai si `dossier` est une racine Mnemo (il contient `_mnemo/SCHEMA.md`). */
export function estRacine(dossier: string): boolean {
	return existsSync(join(dossier, DOSSIER_MEMOIRE, 'SCHEMA.md'));
}

/**
 * Racine Mnemo d'une session et dossier du projet dont on tire la position : `CLAUDE_PROJECT_DIR` s'il est dans une
 * mémoire, sinon le dossier courant, sinon `declaree` (`MNEMO_RACINE`, posée par l'app Claude qui lance le serveur hors de
 * tout dossier) si c'est une racine : le projet est alors la racine elle-même. Le projet est toujours le dossier qui a
 * trouvé la racine (sinon `CLAUDE_PROJECT_DIR` ou le dossier courant, sans racine).
 */
export function racineDeSession(projetDeClaude: string | undefined, dossierCourant: string, declaree?: string): { racine: string | null; projet: string } {
	if (projetDeClaude) {
		const racine = trouverRacine(projetDeClaude);
		if (racine !== null) return { racine, projet: projetDeClaude };
	}
	const racine = trouverRacine(dossierCourant);
	if (racine !== null) return { racine, projet: dossierCourant };
	if (declaree && estRacine(declaree)) return { racine: declaree, projet: declaree };
	return { racine: null, projet: projetDeClaude || dossierCourant };
}
