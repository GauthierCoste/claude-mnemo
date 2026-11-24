/**
 * `.mnemo/reglages.json` : lu sans jamais lever (absent : les défauts ; illisible ou invalide : les défauts et des
 * avertissements), écrit de façon atomique (fichier provisoire à côté, puis renommé), droits 0600.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHAMPS_REGLAGES, fusionnerFichier, lireReglages } from '../domaine/reglages.ts';
import type { Reglages } from '../domaine/reglages.ts';
import { preparerDossierLocal } from './systeme.ts';
import { DOSSIER_LOCAL } from '../domaine/dossier-memoire.ts';

export const NOM_FICHIER_REGLAGES = 'reglages.json';
const AFFICHE = `.mnemo/${NOM_FICHIER_REGLAGES}`;

export const cheminReglages = (racine: string): string => join(racine, DOSSIER_LOCAL, NOM_FICHIER_REGLAGES);

export function lireReglagesDuDossier(racine: string): { reglages: Reglages; avertissements: string[] } {
	let texte: string;
	try {
		texte = readFileSync(cheminReglages(racine), 'utf8');
	} catch (erreur) {
		if ((erreur as NodeJS.ErrnoException).code === 'ENOENT') return lireReglages(undefined);
		const { reglages } = lireReglages(undefined);
		return { reglages, avertissements: [`${AFFICHE} illisible (${(erreur as Error).message}) : valeurs par défaut.`] };
	}
	let brut: unknown;
	try {
		brut = JSON.parse(texte);
	} catch (erreur) {
		const { reglages } = lireReglages(undefined);
		return { reglages, avertissements: [`${AFFICHE} illisible (JSON invalide : ${(erreur as Error).message}) : valeurs par défaut.`] };
	}
	const lus = lireReglages(brut);
	return { reglages: lus.reglages, avertissements: lus.avertissements.map((a) => `${AFFICHE} : ${a}`) };
}

/** Contenu JSON du fichier, sans jamais lever (absent ou illisible : undefined). */
function contenuDuFichier(racine: string): unknown {
	try {
		return JSON.parse(readFileSync(cheminReglages(racine), 'utf8'));
	} catch {
		return undefined;
	}
}

/**
 * Écrit les réglages `cles` (par défaut : tous) dans le fichier, seulement s'ils diffèrent du défaut ; le reste du fichier
 * (réglages inconnus d'une version plus récente, entrées invalides non touchées) est gardé tel quel. Provisoire 0600 dans
 * `.mnemo/`, puis renommé ; rien n'est laissé en échec.
 */
export function ecrireReglagesDuDossier(racine: string, reglages: Reglages, cles: readonly string[] = CHAMPS_REGLAGES.map((c) => c.cle)): void {
	const local = preparerDossierLocal(racine);
	const provisoire = join(local, `.${NOM_FICHIER_REGLAGES}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
	try {
		const texte = `${JSON.stringify(fusionnerFichier(contenuDuFichier(racine), reglages, cles), null, '\t')}\n`;
		writeFileSync(provisoire, texte, { mode: 0o600, flag: 'wx' });
		renameSync(provisoire, cheminReglages(racine));
	} catch (erreur) {
		rmSync(provisoire, { force: true });
		throw erreur;
	}
}

/**
 * Lecteur des réglages d'un dossier pour un processus qui dure (service) : le fichier est relu seulement s'il a changé
 * (inode, date, taille) ; ses avertissements vont à `avertir`, une fois par version du fichier.
 */
export function reglagesDuDossier(racine: string, avertir: (message: string) => void = () => {}): () => Reglages {
	let garde: { cle: string; reglages: Reglages } | null = null;
	return () => {
		let cle = 'absent';
		try {
			const s = statSync(cheminReglages(racine));
			cle = `${s.ino}:${s.mtimeMs}:${s.size}`;
		} catch {
			// absent ou illisible : la lecture le dira
		}
		if (garde === null || garde.cle !== cle) {
			const lus = lireReglagesDuDossier(racine);
			for (const a of lus.avertissements) avertir(a);
			garde = { cle, reglages: lus.reglages };
		}
		return garde.reglages;
	};
}
