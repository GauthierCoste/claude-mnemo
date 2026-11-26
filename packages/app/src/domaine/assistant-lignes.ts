/**
 * Lignes de `mnemo init --json` (`LigneInit`, `@mnemo/contrat`) : découpage du flux en lignes, lecture et validation de
 * chacune (une ligne invalide est ignorée, jamais une erreur), et suivi de l'installation qu'elles décrivent (état de chaque
 * étape, barre de chaque pièce de modèle).
 */
import type { EtapeInit, FinInit, LigneInit } from '@mnemo/contrat';

/** Une ligne plus longue est ignorée (aucune ligne d'`init` n'en approche). */
export const LONGUEUR_MAX_LIGNE = 64 * 1024;

const ETAPES_INIT: readonly EtapeInit[] = ['memoire', 'mcp', 'modeles', 'commande', 'lanceur'];
const ETATS = ['debut', 'fait', 'saute', 'laisse', 'echec'] as const;

const objet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nombre = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Une ligne `LigneInit` validée (champs inconnus retirés), ou null : vide, trop longue, pas du JSON, forme inattendue. */
export function lireLigneInit(texte: string): LigneInit | null {
	const ligne = texte.trim();
	if (ligne === '' || ligne.length > LONGUEUR_MAX_LIGNE) return null;
	let brut: unknown;
	try {
		brut = JSON.parse(ligne);
	} catch {
		return null;
	}
	if (!objet(brut)) return null;
	if (brut['fin'] === true) {
		const { racine, ok } = brut;
		return typeof racine === 'string' && racine !== '' && typeof ok === 'boolean' ? { fin: true, racine, ok } : null;
	}
	const { etape, etat } = brut;
	if (etape === 'modeles' && etat === 'progression') {
		const { piece, libelle, recu, total } = brut;
		if (typeof piece !== 'string' || piece === '' || typeof libelle !== 'string' || !nombre(recu) || !(total === null || nombre(total))) return null;
		return { etape, etat, piece, libelle, recu, total };
	}
	const { message, motif } = brut;
	if (!ETAPES_INIT.includes(etape as EtapeInit) || !ETATS.includes(etat as (typeof ETATS)[number]) || typeof message !== 'string') return null;
	// `motif` gardé seulement là où le contrat le prévoit (échec de la déclaration) ; une valeur inconnue est retirée
	if (etape === 'mcp' && etat === 'echec' && motif === 'perime') return { etape, etat, message, motif };
	return { etape: etape as EtapeInit, etat: etat as (typeof ETATS)[number], message };
}

/**
 * Découpe un flux de texte en lignes complètes : `ajouter` rend les lignes que le morceau termine, `finir` la dernière
 * (sans fin de ligne). Une ligne qui dépasse `LONGUEUR_MAX_LIGNE` sans finir est jetée jusqu'à sa fin.
 */
export function decoupeurLignes(): { ajouter(morceau: string): string[]; finir(): string[] } {
	let reste = '';
	let jeter = false;
	return {
		ajouter(morceau) {
			const parties = (reste + morceau).split('\n');
			reste = parties.pop() ?? '';
			const lignes: string[] = [];
			for (const p of parties) {
				if (jeter) jeter = false;
				else lignes.push(p.replace(/\r$/u, ''));
			}
			if (reste.length > LONGUEUR_MAX_LIGNE) {
				reste = '';
				jeter = true;
			}
			return lignes;
		},
		finir() {
			const derniere = jeter ? '' : reste;
			reste = '';
			jeter = false;
			return derniere === '' ? [] : [derniere];
		},
	};
}

/** Étapes que la page montre, dans l'ordre (le lanceur n'est jamais demandé par l'assistant). */
export const ETAPES_MONTREES = ['memoire', 'mcp', 'modeles', 'commande'] as const;
export type EtapeMontree = (typeof ETAPES_MONTREES)[number];

export const LIBELLES_ETAPES: Readonly<Record<EtapeMontree, string>> = {
	memoire: 'Mémoire',
	mcp: 'Déclaration à Claude Code',
	modeles: 'Modèles locaux',
	commande: 'Commande « mnemo »',
};

export type EtatEtape = 'attente' | 'debut' | 'fait' | 'saute' | 'laisse' | 'echec';
export type EtapeSuivie = { etape: EtapeMontree; etat: EtatEtape; message: string };
/** Une pièce de modèle en téléchargement ; `finie` : sa barre est pleine (la suivante a commencé, ou les modèles sont faits). */
export type PieceSuivie = { piece: string; libelle: string; recu: number; total: number | null; finie: boolean };

/** Fin du processus `init`, vue du processus principal : la ligne `fin` s'il l'a lue, sinon pourquoi il n'y en a pas. */
export type ResultatInstallation = { fin: FinInit | null; erreur: string | null };

export type EtatInstallation = { etapes: EtapeSuivie[]; pieces: PieceSuivie[]; fin: FinInit | null; erreur: string | null; enCours: boolean };

export function installationVide(): EtatInstallation {
	return { etapes: ETAPES_MONTREES.map((etape) => ({ etape, etat: 'attente', message: '' })), pieces: [], fin: null, erreur: null, enCours: true };
}

const finie = (p: PieceSuivie): PieceSuivie => (p.finie ? p : { ...p, finie: true });

/**
 * Applique une ligne. Progression : la pièce est mise à jour, ou ajoutée en remplissant les précédentes (une pièce
 * commence quand la précédente a fini ; la dernière progression d'une pièce peut manquer) ; modèles faits : toutes pleines.
 */
export function appliquerLigne(i: EtatInstallation, ligne: LigneInit): EtatInstallation {
	if ('fin' in ligne) return { ...i, fin: ligne };
	if (ligne.etat === 'progression') {
		const existe = i.pieces.some((p) => p.piece === ligne.piece);
		const piece = { piece: ligne.piece, libelle: ligne.libelle, recu: ligne.recu, total: ligne.total };
		const pieces = existe ? i.pieces.map((p) => (p.piece === ligne.piece ? { ...piece, finie: p.finie } : p)) : [...i.pieces.map(finie), { ...piece, finie: false }];
		return { ...i, pieces };
	}
	if (!(ETAPES_MONTREES as readonly string[]).includes(ligne.etape)) return i;
	const etapes = i.etapes.map((e) => (e.etape === ligne.etape ? { ...e, etat: ligne.etat, message: ligne.message } : e));
	const pieces = ligne.etape === 'modeles' && ligne.etat === 'fait' ? i.pieces.map(finie) : i.pieces;
	return { ...i, etapes, pieces };
}

/** Part remplie de la barre d'une pièce, de 0 à 1 ; null si la taille est inconnue (barre indéterminée). */
export function fractionPiece(p: PieceSuivie): number | null {
	if (p.finie) return 1;
	if (p.total === null || p.total === 0) return null;
	return Math.min(1, p.recu / p.total);
}

/** La mémoire est faite et `init` a fini : on peut ouvrir Mnemo (les autres échecs sont dits, sans bloquer). */
export function peutTerminer(i: EtatInstallation): boolean {
	return !i.enCours && i.fin !== null && i.etapes.some((e) => e.etape === 'memoire' && e.etat === 'fait');
}
