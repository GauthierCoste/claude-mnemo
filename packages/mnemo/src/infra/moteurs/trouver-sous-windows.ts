import { join } from 'node:path';
import type { CommandeMoteur } from '../../application/ports.ts';
import { estFichier } from './executables.ts';
import { cibleDuShim } from './shim-npm.ts';

/**
 * Windows : `<nom>.exe` d'abord dans tous les `dossiers`, puis un shim npm `<nom>.cmd` remplacé par sa cible (`paquet` : le
 * script du paquet à côté du shim, à défaut d'une cible lisible). Introuvable : null.
 */
export function trouverSousWindows(nom: string, dossiers: readonly string[], paquet: readonly string[]): CommandeMoteur | null {
	for (const dossier of dossiers) {
		for (const fichier of [`${nom}.exe`, `${nom}.EXE`]) {
			const candidat = join(dossier, fichier);
			if (estFichier(candidat)) return { commande: candidat, avant: [] };
		}
	}
	for (const dossier of dossiers) {
		for (const fichier of [`${nom}.cmd`, `${nom}.CMD`]) {
			const candidat = join(dossier, fichier);
			if (!estFichier(candidat)) continue;
			const cible = cibleDuShim(candidat, paquet);
			if (cible !== null) return cible;
		}
	}
	return null;
}
