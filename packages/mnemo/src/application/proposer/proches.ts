import { ecrirePortee } from '../../domaine/portee.ts';
import { SEUIL_PROCHE, similarite } from '../../domaine/requete.ts';
import { chercherSansSynchro } from '../chercher.ts';
import type { Trouve } from '../chercher.ts';
import { cheminDeFiche } from '../commun.ts';
import type { Dependances } from '../ports.ts';
import { normaliser } from './consigne.ts';
import type { DemandeConsigne } from './consigne.ts';
import { SANS_EXTRACTION, synchroniser } from '../synchroniser.ts';
import type { DemandeFait } from './fait.ts';

const LIMITE = 5;
const LIMITE_CONSIGNE = 10;

/** Énoncé d'un fait indexé : `Trouve.texte` est « énoncé\ncitation » ; l'énoncé tient sur une seule ligne, c'est donc la première. */
const enonceDe = (trouve: Trouve) => trouve.texte.split('\n')[0]!;

/** Dossier de la fiche cible (« » à la racine). */
function dossierDe(chemin: string): string {
	const i = chemin.lastIndexOf('/');
	return i < 0 ? '' : chemin.slice(0, i);
}

/**
 * Faits très proches (similarité ≥ SEUIL_PROCHE) de la demande, dans le dossier de la fiche cible puis partout, sans
 * seuil de rappel, à confirmer inclus. Un fait de même énoncé exact n'est pas un proche (le chemin d'écriture le
 * traite) ; s'il est dans la fiche cible, la demande est un doublon et rien n'est rendu.
 */
export async function prochesDeFait(dep: Dependances, demande: DemandeFait): Promise<Trouve[]> {
	const chemin = cheminDeFiche(demande.fiche)!;
	const base = { texte: demande.texte, inclureAConfirmer: true, genres: ['fait' as const], limite: LIMITE, sansSeuil: true, dedoublonner: false };
	const perimetre = dossierDe(chemin);
	const trouves = new Map<string, Trouve>();
	await synchroniser(dep, SANS_EXTRACTION);
	// Par les mots seuls : le filtre de Jaccard (≥ 0,6) rendrait inutile un voisin trouvé par le seul sens.
	if (perimetre !== '') for (const t of await chercherSansSynchro(dep, { ...base, perimetre })) trouves.set(t.id, t);
	for (const t of await chercherSansSynchro(dep, base)) trouves.set(t.id, t);

	const cherche = normaliser(demande.texte);
	const proches: Trouve[] = [];
	for (const trouve of trouves.values()) {
		const enonce = enonceDe(trouve);
		if (normaliser(enonce) === cherche) {
			if (trouve.chemin === chemin) return [];
			continue;
		}
		if (similarite(demande.texte, enonce) >= SEUIL_PROCHE) proches.push(trouve);
	}

	return proches;
}

/**
 * Consignes de même portée très proches de la demande. Une consigne de même texte exact (répétition, traitée par le
 * chemin d'écriture) l'emporte : alors aucun proche n'est rendu.
 */
export async function prochesDeConsigne(dep: Dependances, demande: DemandeConsigne): Promise<Trouve[]> {
	const portee = ecrirePortee(demande.portee);
	await synchroniser(dep, SANS_EXTRACTION);
	const cherche = normaliser(demande.texte);
	// Répétition exacte : vérifiée sur toutes les consignes de même portée, sans dépendre du nombre de candidats.
	const portees = new Map<string, string | null>();
	for (const e of await dep.index.elements({ genres: ['consigne'] })) {
		if (e.portee !== portee) continue;
		if (normaliser(e.texte) === cherche) return [];
		portees.set(e.id, e.portee);
	}
	const trouves = await chercherSansSynchro(dep, { texte: demande.texte, genres: ['consigne'], limite: LIMITE_CONSIGNE, sansSeuil: true, dedoublonner: false });
	const proches: Trouve[] = [];
	for (const trouve of trouves) {
		if (!portees.has(trouve.id)) continue;
		if (similarite(demande.texte, trouve.texte) >= SEUIL_PROCHE) proches.push(trouve);
	}

	return proches.slice(0, LIMITE);
}
