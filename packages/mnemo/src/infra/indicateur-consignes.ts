import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EtatIndicateur } from '../domaine/refus-outil.ts';

// Chargé par chaque hook `outil` : rien de lourd ici (ni SQLite, ni l'index).

/** Fichiers de l'état local (`DOSSIER_LOCAL`) que le hook `outil` lit. */
export const FICHIER_INDEX = 'index.sqlite';
export const FICHIER_CONSIGNES_VERIFIEES = 'consignes-verifiees.json';

/** `etat` de la note : `a_jour` (avec `presentes`) après une synchronisation, `pas_a_jour` après une réindexation en échec. */
const A_JOUR = 'a_jour';
const PAS_A_JOUR = 'pas_a_jour';

/**
 * Note, dans `dossierLocal` (`.mnemo/`), si la mémoire contient des consignes vérifiées (fichier temporaire puis renommage : jamais
 * lu à moitié). Écriture impossible : l'ancienne note est retirée, pour qu'une note périmée ne rende pas le hook permissif.
 */
export function ecrireIndicateur(dossierLocal: string, presentes: boolean, horodatageMs: number): void {
	ecrire(dossierLocal, { etat: A_JOUR, presentes, horodatageMs });
}

/** Réindexation en échec après une écriture : l'index ne dit plus la mémoire, la note devient illisible (strict). */
export function marquerIndicateurIllisible(dossierLocal: string, horodatageMs: number): void {
	ecrire(dossierLocal, { etat: PAS_A_JOUR, horodatageMs });
}

function ecrire(dossierLocal: string, contenu: Record<string, unknown>): void {
	const fichier = join(dossierLocal, FICHIER_CONSIGNES_VERIFIEES);
	const temporaire = `${fichier}.${process.pid}.tmp`;
	try {
		writeFileSync(temporaire, `${JSON.stringify(contenu)}\n`, { mode: 0o600 });
		renameSync(temporaire, fichier);
	} catch {
		try {
			rmSync(fichier, { force: true });
		} catch {
			// rien à retirer, ou retrait impossible : la note reste lue comme elle est
		}
	}
}

/** Indicateur lu dans `dossierLocal`, sans ouvrir l'index. */
export function lireIndicateur(dossierLocal: string): EtatIndicateur {
	const fichier = join(dossierLocal, FICHIER_CONSIGNES_VERIFIEES);
	let texte: string;
	try {
		texte = readFileSync(fichier, 'utf8');
	} catch (erreur) {
		if ((erreur as NodeJS.ErrnoException).code === 'ENOENT') return { genre: 'absent', indexExiste: existsSync(join(dossierLocal, FICHIER_INDEX)) };
		return { genre: 'illisible' };
	}
	try {
		const lu: unknown = JSON.parse(texte);
		if (typeof lu !== 'object' || lu === null || Array.isArray(lu)) return { genre: 'illisible' };
		const { etat, presentes, horodatageMs } = lu as Record<string, unknown>;
		if (typeof horodatageMs !== 'number' || !Number.isFinite(horodatageMs)) return { genre: 'illisible' };
		switch (etat) {
			case A_JOUR:
				return typeof presentes === 'boolean' ? { genre: 'note', presentes, horodatageMs } : { genre: 'illisible' };
			case PAS_A_JOUR:
				return { genre: 'illisible' };
			default:
				// état inconnu ou absent : refusé, donc strict
				return { genre: 'illisible' };
		}
	} catch {
		return { genre: 'illisible' };
	}
}
