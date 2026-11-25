import { stat } from 'node:fs/promises';
import { piecesPourPlateforme } from './catalogue.ts';
import type { IdentiteModele, Piece } from './catalogue.ts';
import { etatDesPieces } from './installer.ts';

/** Un modèle installé, pour l'afficher : son identité, la taille de son fichier, le début de son SHA-256. */
export type ModeleInstalle = IdentiteModele & { octets: number; empreinte: string };
/** Les pièces installées de la machine ; null : pas installée (ou aucune pièce figée pour cette plateforme). */
export type PiecesInstallees = {
	sens: ModeleInstalle | null;
	reranker: ModeleInstalle | null;
	moteur: { version: string; plateforme: string } | null;
};

/** Longueur du début du SHA-256 affiché. */
const LONGUEUR_EMPREINTE = 8;
const SYSTEMES: Partial<Record<NodeJS.Platform, string>> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };

/** Plateforme lisible : « macOS arm64 », « Windows x64 ». */
export function plateformeLisible(plateforme: NodeJS.Platform, arch: string): string {
	return `${SYSTEMES[plateforme] ?? plateforme} ${arch}`;
}

/**
 * Pièces installées dans `dossierModeles` (le cache des pièces), tirées du catalogue figé : installée = vérifiée à son
 * installation (`etatDesPieces`), d'où une empreinte prise au catalogue sans relire le fichier ; la taille est celle du
 * fichier installé.
 */
export async function piecesInstallees(dossierModeles: string, plateforme: NodeJS.Platform = process.platform, arch: string = process.arch): Promise<PiecesInstallees> {
	const vide: PiecesInstallees = { sens: null, reranker: null, moteur: null };
	const pieces = piecesPourPlateforme(plateforme, arch);
	if (pieces === null) return vide;
	const etats = await etatDesPieces(dossierModeles, pieces);
	const installee = (nom: Piece['nom']) => etats.find((e) => e.piece.nom === nom && e.installee) ?? null;
	const modele = async (nom: 'sens' | 'reranker'): Promise<ModeleInstalle | null> => {
		const etat = installee(nom);
		if (etat === null || etat.piece.nom === 'moteur') return null;
		const { modele, editeur, quantification, sha256 } = etat.piece;
		try {
			return { modele, editeur, quantification, octets: (await stat(etat.chemin)).size, empreinte: sha256.slice(0, LONGUEUR_EMPREINTE) };
		} catch {
			return null;
		}
	};
	const moteur = installee('moteur');
	return {
		sens: await modele('sens'),
		reranker: await modele('reranker'),
		moteur: moteur === null || moteur.piece.nom !== 'moteur' ? null : { version: moteur.piece.version, plateforme: plateformeLisible(plateforme, arch) },
	};
}
