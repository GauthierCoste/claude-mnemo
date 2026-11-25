import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { piecesPourPlateforme } from '../../infra/modeles/catalogue.ts';
import type { Piece } from '../../infra/modeles/catalogue.ts';
import { dossierModeles, SOUS_DOSSIER_SERVEURS } from '../../infra/modeles/dossier.ts';
import { etatDesPieces, installerPiece } from '../../infra/modeles/installer.ts';
import type { Telecharger } from '../../infra/modeles/installer.ts';
import { migrerAncienGardien } from '../../infra/modeles/migration-gardien-dossier.ts';
import { arreterServeurs, lireEtatServeurs, pidVivant, serveursVerifies } from '../../infra/modeles/serveurs.ts';
import type { ResultatArret } from '../../infra/modeles/serveurs.ts';
import { telechargerFichier } from '../../infra/modeles/telechargement.ts';
import { ErreurCli } from './erreurs.ts';
import { trouverRacine } from './racine.ts';

const USAGE = 'Usage : mnemo modeles etat | mnemo modeles installer [--depuis <dossier>] | mnemo modeles arreter';

/** Ce que la commande lit de la machine ; remplaçable dans les tests (aucun téléchargement réel). */
export type ContexteModeles = {
	plateforme: NodeJS.Platform;
	arch: string;
	dossier: string;
	/** Par défaut : les pièces figées de la plateforme. */
	pieces: Piece[] | null;
	telecharger: Telecharger;
	/**
	 * Dossier Mnemo dont `arreter` retire l'ancien gardien (un par dossier jusqu'à la 1.5 : migration) ; par défaut celui du
	 * dossier courant (null : aucun). Les serveurs, eux, sont ceux de la machine (`serveurs/` de `dossier`).
	 */
	racine: string | null;
	/** Lignes de `installer` : la sortie et l'erreur standard par défaut (`mnemo init --json` les garde pour lui). */
	journal: { info(ligne: string): void; erreur(ligne: string): void };
	/** Progression de chaque téléchargement de `installer` ; null : en pourcentage sur un terminal (stderr), sinon rien. */
	progression: ((piece: Piece, recu: number, total: number | null) => void) | null;
};

/** Progression sur stderr, seulement vers un terminal, par pas d'environ 5 %. */
function telechargerAvecProgression(libelle: string): Telecharger {
	if (!process.stderr.isTTY) return (url, vers) => telechargerFichier(url, vers);
	let dernier = -1;
	return async (url, vers) => {
		const empreinte = await telechargerFichier(url, vers, {
			progression: (recu, total) => {
				if (total === null) return;
				const pourcent = Math.floor((recu / total) * 100);
				if (pourcent >= dernier + 5 || (pourcent === 100 && dernier !== 100)) {
					dernier = pourcent;
					process.stderr.write(`\r${libelle} : ${pourcent} %`);
				}
			},
		});
		if (dernier >= 0) process.stderr.write('\n');
		return empreinte;
	};
}

function contexteReel(partiel: Partial<ContexteModeles>): ContexteModeles {
	const plateforme = partiel.plateforme ?? process.platform;
	const arch = partiel.arch ?? process.arch;
	return {
		plateforme,
		arch,
		dossier: partiel.dossier ?? dossierModeles(process.env, plateforme, homedir()),
		pieces: partiel.pieces !== undefined ? partiel.pieces : piecesPourPlateforme(plateforme, arch),
		telecharger: partiel.telecharger ?? ((url, vers) => telechargerFichier(url, vers)),
		racine: partiel.racine !== undefined ? partiel.racine : trouverRacine(process.cwd()),
		journal: partiel.journal ?? { info: (ligne) => console.log(ligne), erreur: (ligne) => console.error(ligne) },
		progression: partiel.progression ?? null,
	};
}

async function etat(contexte: ContexteModeles, pieces: Piece[]): Promise<void> {
	console.log(`Dossier des modèles : ${contexte.dossier}`);
	for (const { piece, installee, chemin } of await etatDesPieces(contexte.dossier, pieces)) {
		console.log(installee ? `${piece.libelle} : installé — ${chemin}` : `${piece.libelle} : absent (mnemo modeles installer)`);
	}
	await serveursEnMarche(join(contexte.dossier, SOUS_DOSSIER_SERVEURS));
}

/** Serveurs de la machine en marche, d'après `serveurs/modeles.json` : seulement ceux qui répondent avec leur clé. */
async function serveursEnMarche(dossier: string): Promise<void> {
	const etat = await lireEtatServeurs(dossier);
	const verifies = etat === null || !pidVivant(etat.gardien.pid) ? [] : await serveursVerifies(etat, Date.now() + 1000);
	if (verifies.length === 0) {
		console.log(etat?.gardien.etat === 'demarrage' && pidVivant(etat.gardien.pid) ? 'Serveurs : en chargement' : 'Serveurs : aucun serveur en marche');
		return;
	}
	for (const { type, entree } of verifies) console.log(`serveur ${type} : port ${entree.port}, ${entree.modele}, depuis ${entree.depuis}`);
}

async function installer(contexte: ContexteModeles, pieces: Piece[], depuis: string | undefined, injecte: boolean): Promise<void> {
	const { journal, progression } = contexte;
	let echecs = 0;
	let nouvelles = 0;
	for (const piece of pieces) {
		const telecharger: Telecharger = injecte
			? contexte.telecharger
			: progression !== null
				? (url, vers) => telechargerFichier(url, vers, { progression: (recu, total) => progression(piece, recu, total) })
				: telechargerAvecProgression(piece.libelle);
		try {
			const resultat = await installerPiece(contexte.dossier, piece, { telecharger, ...(depuis === undefined ? {} : { depuis }) });
			for (const ecarte of resultat.statut === 'deja' ? [] : (resultat.ecartes ?? [])) {
				journal.info(`${piece.libelle} : ${ecarte} écarté (empreinte différente)`);
			}
			if (resultat.statut !== 'deja') nouvelles++;
			if (resultat.statut === 'deja') journal.info(`${piece.libelle} : déjà installé`);
			else if (resultat.statut === 'copie') journal.info(`${piece.libelle} : installé depuis ${resultat.depuis}`);
			else journal.info(`${piece.libelle} : téléchargé`);
		} catch (erreur) {
			echecs++;
			journal.erreur(`${piece.libelle} : échec — ${erreur instanceof Error ? erreur.message : String(erreur)}`);
		}
	}
	// Des serveurs lancés avant cette installation ne connaissent pas la pièce neuve : ils sont arrêtés, le prochain appel les
	// relance avec tout ce qui est installé.
	if (nouvelles > 0 && (await arreterServeurs(join(contexte.dossier, SOUS_DOSSIER_SERVEURS))) === 'arrete') {
		journal.info('Serveurs des modèles arrêtés : ils repartiront avec les pièces neuves.');
	}
	if (echecs > 0) throw new ErreurCli(`${echecs} ${echecs === 1 ? 'pièce non installée' : 'pièces non installées'}.`, 1);
}

/** Un seul bilan pour deux arrêts : des serveurs en chargement d'abord, puis un arrêt, puis un état périmé. */
function combinerArrets(a: ResultatArret | null, b: ResultatArret): ResultatArret {
	const tous = a === null ? [b] : [a, b];
	const enChargement = tous.reduce((n, r) => n + (typeof r === 'object' ? r.enChargement : 0), 0);
	if (enChargement > 0) return { enChargement };
	if (tous.includes('arrete')) return 'arrete';
	return tous.includes('perime') ? 'perime' : 'rien';
}

/** `mnemo modeles etat` : une ligne par pièce ; `mnemo modeles installer [--depuis <dossier>]` : installe celles qui manquent. */
export async function commandeModeles(args: string[], partiel: Partial<ContexteModeles> = {}): Promise<void> {
	const [action, ...reste] = args;
	let depuis: string | undefined;
	if (action === 'garde') {
		// interne : le gardien des serveurs de la machine, lancé détaché par le premier appel qui en a besoin
		if (reste.length > 0) throw new ErreurCli(USAGE, 2);
		const { garder } = await import('../../infra/modeles/gardien.ts');
		return garder();
	}
	if (action === 'arreter') {
		if (reste.length > 0) throw new ErreurCli(USAGE, 2);
		const contexte = contexteReel(partiel);
		// l'ancien gardien du dossier courant (migration), puis celui de la machine
		const ancien = contexte.racine === null ? null : await migrerAncienGardien(contexte.racine);
		const resultat = combinerArrets(ancien, await arreterServeurs(join(contexte.dossier, SOUS_DOSSIER_SERVEURS)));
		if (typeof resultat === 'object') {
			console.log(`${resultat.enChargement} serveur(s) encore en chargement : relancez \`mnemo modeles arreter\` dans un instant.`);
			return;
		}
		console.log(resultat === 'arrete' ? 'Serveurs arrêtés.' : resultat === 'perime' ? 'Aucun serveur en marche : état périmé retiré.' : 'Aucun serveur en marche.');
		return;
	}
	if (action === 'etat') {
		if (reste.length > 0) throw new ErreurCli(USAGE, 2);
	} else if (action === 'installer') {
		for (let i = 0; i < reste.length; i++) {
			const arg = reste[i]!;
			if (arg === '--depuis' && depuis === undefined) {
				const valeur = reste[++i];
				if (valeur === undefined || valeur === '') throw new ErreurCli(USAGE, 2);
				depuis = resolve(valeur);
			} else if (arg.startsWith('--')) throw new ErreurCli(`Option inconnue : « ${arg} ».\n${USAGE}`, 2);
			else throw new ErreurCli(USAGE, 2);
		}
	} else throw new ErreurCli(USAGE, 2);

	const contexte = contexteReel(partiel);
	if (contexte.pieces === null) {
		const message = `plateforme non prise en charge : ${contexte.plateforme}-${contexte.arch} ; la recherche se fait par les mots`;
		if (action === 'installer') throw new ErreurCli(message, 1);
		console.log(`Dossier des modèles : ${contexte.dossier}`);
		console.log(message);
		return;
	}
	if (action === 'etat') await etat(contexte, contexte.pieces);
	else await installer(contexte, contexte.pieces, depuis, partiel.telecharger !== undefined);
}
