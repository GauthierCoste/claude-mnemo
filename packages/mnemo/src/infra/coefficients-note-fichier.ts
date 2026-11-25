/**
 * Coefficients de la note de confiance d'une mémoire (spec classement vivant § 4.2, décisions du 25/11) :
 * `.mnemo/coefficients-note.json`, écrit par `mnemo banc contexte --apprendre`, chargé en priorité ; sinon (absent, illisible
 * ou invalide) le module du dépôt, `domaine/coefficients-note.ts`. Avec l'identité des modèles installés (fichiers GGUF du
 * sens et du reranker de cette plateforme) : un modèle appris pour d'autres fichiers est refusé.
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { COEFFICIENTS_NOTE } from '../domaine/coefficients-note.ts';
import { DOSSIER_LOCAL } from '../domaine/dossier-memoire.ts';
import { lireCoefficients } from '../domaine/modele-de-note.ts';
import type { CoefficientsNote, IdentiteDesModeles } from '../domaine/modele-de-note.ts';
import type { NoteChargee } from '../application/ports.ts';
import { piecesPourPlateforme } from './modeles/catalogue.ts';

/** Coefficients appris d'une mémoire. */
export const fichierDesCoefficients = (racine: string) => join(racine, DOSSIER_LOCAL, 'coefficients-note.json');

/** Fichiers GGUF du sens et du reranker de cette plateforme : nom du fichier et début du SHA-256. */
export function ggufInstalles(plateforme: NodeJS.Platform = process.platform, arch: string = process.arch): IdentiteDesModeles {
	const pieces = piecesPourPlateforme(plateforme, arch) ?? [];
	const identite = (nom: string) => {
		const p = pieces.find((x) => x.nom === nom);
		return p === undefined ? null : `${p.fichier}@${p.sha256.slice(0, 12)}`;
	};
	return { sens: identite('sens'), reranker: identite('reranker') };
}

/** Les coefficients de la mémoire : son fichier s'il est lisible et valide (`avertissement` sinon, s'il existe), ou ceux du module. */
export function lireCoefficientsDuDossier(racine: string): { coefficients: CoefficientsNote; avertissement: string | null } {
	let texte: string;
	try {
		texte = readFileSync(fichierDesCoefficients(racine), 'utf8');
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { coefficients: COEFFICIENTS_NOTE, avertissement: null };
		return { coefficients: COEFFICIENTS_NOTE, avertissement: `.mnemo/coefficients-note.json illisible (${(e as Error).message}) : coefficients par défaut.` };
	}
	let lus: CoefficientsNote | null = null;
	try {
		lus = lireCoefficients(JSON.parse(texte));
	} catch {
		lus = null;
	}
	return lus === null ? { coefficients: COEFFICIENTS_NOTE, avertissement: '.mnemo/coefficients-note.json invalide : coefficients par défaut.' } : { coefficients: lus, avertissement: null };
}

/**
 * Lecteur des coefficients d'une mémoire pour un processus qui dure (service) : le fichier est relu seulement s'il a changé
 * (inode, date, taille), un nouvel apprentissage vaut donc dès le message suivant ; son avertissement va à `avertir`, une fois
 * par version du fichier. `installes` : l'identité des modèles installés (défaut : ceux de cette plateforme).
 */
export function noteDuDossier(racine: string, avertir: (message: string) => void = () => {}, installes: IdentiteDesModeles = ggufInstalles()): () => NoteChargee {
	let garde: { cle: string; coefficients: CoefficientsNote } | null = null;
	return () => {
		let cle = 'absent';
		try {
			const s = statSync(fichierDesCoefficients(racine));
			cle = `${s.ino}:${s.mtimeMs}:${s.size}`;
		} catch {
			// absent ou illisible : la lecture le dira
		}
		if (garde === null || garde.cle !== cle) {
			const lus = lireCoefficientsDuDossier(racine);
			if (lus.avertissement !== null) avertir(lus.avertissement);
			garde = { cle, coefficients: lus.coefficients };
		}
		return { coefficients: garde.coefficients, installes };
	};
}
