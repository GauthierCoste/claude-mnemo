/**
 * Coefficients de la note de confiance d'une mémoire (spec classement vivant § 4.2, décisions du 25/11) :
 * `.mnemo/coefficients-note.json`, écrit par `mnemo banc contexte --apprendre`, chargé en priorité ; absent : le module du
 * dépôt, `domaine/coefficients-note.ts` ; présent mais illisible ou invalide : aucun modèle appris (un fichier abîmé ne fait pas
 * revenir à d'autres coefficients que ceux de la mémoire), avec un avertissement. Avec l'identité des modèles installés
 * (fichiers GGUF du sens et du reranker de cette plateforme) : un modèle appris pour d'autres fichiers est refusé.
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { COEFFICIENTS_NOTE } from '../domaine/coefficients-note.ts';
import { DOSSIER_LOCAL } from '../domaine/dossier-memoire.ts';
import { lireCoefficients, modeleNonAppris } from '../domaine/modele-de-note.ts';
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

/** Aucun modèle appris : ce que vaut un fichier de coefficients abîmé. */
const aucunModele = (): CoefficientsNote => ({ complets: modeleNonAppris(), sens: modeleNonAppris() });

/**
 * Les coefficients de la mémoire : son fichier s'il est lisible et valide ; absent, ceux du module ; illisible ou invalide, aucun
 * modèle appris, avec un avertissement.
 */
export function lireCoefficientsDuDossier(racine: string): { coefficients: CoefficientsNote; avertissement: string | null } {
	let texte: string;
	try {
		texte = readFileSync(fichierDesCoefficients(racine), 'utf8');
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { coefficients: COEFFICIENTS_NOTE, avertissement: null };
		return { coefficients: aucunModele(), avertissement: `.mnemo/coefficients-note.json illisible (${(e as Error).message}) : aucun modèle de note.` };
	}
	let lus: CoefficientsNote | null = null;
	try {
		lus = lireCoefficients(JSON.parse(texte));
	} catch {
		lus = null;
	}
	return lus === null ? { coefficients: aucunModele(), avertissement: '.mnemo/coefficients-note.json invalide : aucun modèle de note (relancer mnemo banc contexte --apprendre).' } : { coefficients: lus, avertissement: null };
}

/** Lecteurs créés par `noteDuDossier`, et leur dossier : le service les recrée avec son journal (`noteAvecJournal`). */
const lecteurs = new WeakMap<() => NoteChargee, { racine: string; installes: IdentiteDesModeles }>();

/**
 * Lecteur des coefficients d'une mémoire pour un processus qui dure (service) : le fichier est relu seulement s'il a changé
 * (inode, date, taille), un nouvel apprentissage vaut donc dès le message suivant ; son avertissement va à `avertir`, une fois
 * par version du fichier. `installes` : l'identité des modèles installés (défaut : ceux de cette plateforme).
 */
export function noteDuDossier(racine: string, avertir: (message: string) => void = () => {}, installes: IdentiteDesModeles = ggufInstalles()): () => NoteChargee {
	let garde: { cle: string; coefficients: CoefficientsNote } | null = null;
	const lire = () => {
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
	lecteurs.set(lire, { racine, installes });
	return lire;
}

/** Le lecteur des coefficients avec ses avertissements dans `journal` (service) ; un autre lecteur (tests) reste tel quel. */
export function noteAvecJournal(note: (() => NoteChargee) | undefined, journal: (message: string) => void): (() => NoteChargee) | undefined {
	const l = note === undefined ? undefined : lecteurs.get(note);
	return l === undefined ? note : noteDuDossier(l.racine, journal, l.installes);
}
