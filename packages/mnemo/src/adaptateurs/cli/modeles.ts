import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { piecesPourPlateforme } from '../../infra/modeles/catalogue.ts';
import type { Piece } from '../../infra/modeles/catalogue.ts';
import { dossierModeles } from '../../infra/modeles/dossier.ts';
import { etatDesPieces, installerPiece } from '../../infra/modeles/installer.ts';
import type { Telecharger } from '../../infra/modeles/installer.ts';
import { arreterServeurs, lireEtatServeurs, pidVivant, serveursVerifies } from '../../infra/modeles/serveurs.ts';
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
	/** Dossier Mnemo dont on montre ou arrête les serveurs ; par défaut celui du dossier courant (null : aucun). */
	racine: string | null;
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
	};
}

async function etat(contexte: ContexteModeles, pieces: Piece[]): Promise<void> {
	console.log(`Dossier des modèles : ${contexte.dossier}`);
	for (const { piece, installee, chemin } of await etatDesPieces(contexte.dossier, pieces)) {
		console.log(installee ? `${piece.libelle} : installé — ${chemin}` : `${piece.libelle} : absent (mnemo modeles installer)`);
	}
	await serveursEnMarche(contexte.racine);
}

/** Serveurs du dossier Mnemo en marche, d'après `.mnemo/modeles.json` : seulement ceux qui répondent avec leur clé. */
async function serveursEnMarche(racine: string | null): Promise<void> {
	if (racine === null) return;
	const etat = await lireEtatServeurs(racine);
	const verifies = etat === null || !pidVivant(etat.gardien.pid) ? [] : await serveursVerifies(etat, Date.now() + 1000);
	if (verifies.length === 0) {
		console.log(etat?.gardien.etat === 'demarrage' && pidVivant(etat.gardien.pid) ? 'Serveurs : en chargement' : 'Serveurs : aucun serveur en marche');
		return;
	}
	for (const { type, entree } of verifies) console.log(`serveur ${type} : port ${entree.port}, ${entree.modele}, depuis ${entree.depuis}`);
}

async function installer(contexte: ContexteModeles, pieces: Piece[], depuis: string | undefined, injecte: boolean): Promise<void> {
	let echecs = 0;
	let nouvelles = 0;
	for (const piece of pieces) {
		const telecharger = injecte ? contexte.telecharger : telechargerAvecProgression(piece.libelle);
		try {
			const resultat = await installerPiece(contexte.dossier, piece, { telecharger, ...(depuis === undefined ? {} : { depuis }) });
			for (const ecarte of resultat.statut === 'deja' ? [] : (resultat.ecartes ?? [])) {
				console.log(`${piece.libelle} : ${ecarte} écarté (empreinte différente)`);
			}
			if (resultat.statut !== 'deja') nouvelles++;
			if (resultat.statut === 'deja') console.log(`${piece.libelle} : déjà installé`);
			else if (resultat.statut === 'copie') console.log(`${piece.libelle} : installé depuis ${resultat.depuis}`);
			else console.log(`${piece.libelle} : téléchargé`);
		} catch (erreur) {
			echecs++;
			console.error(`${piece.libelle} : échec — ${erreur instanceof Error ? erreur.message : String(erreur)}`);
		}
	}
	// Des serveurs lancés avant cette installation ne connaissent pas la pièce neuve : ceux de ce dossier sont arrêtés, le
	// prochain appel les relance avec tout ce qui est installé (ceux des autres dossiers s'arrêtent après 15 min sans requête).
	if (nouvelles > 0 && contexte.racine !== null && (await arreterServeurs(contexte.racine)) === 'arrete') {
		console.log('Serveurs de ce dossier arrêtés : ils repartiront avec les pièces neuves.');
	}
	if (echecs > 0) throw new ErreurCli(`${echecs} ${echecs === 1 ? 'pièce non installée' : 'pièces non installées'}.`, 1);
}

/** `mnemo modeles etat` : une ligne par pièce ; `mnemo modeles installer [--depuis <dossier>]` : installe celles qui manquent. */
export async function commandeModeles(args: string[], partiel: Partial<ContexteModeles> = {}): Promise<void> {
	const [action, ...reste] = args;
	let depuis: string | undefined;
	if (action === 'garde') {
		// interne : le gardien des serveurs d'un dossier, lancé détaché par le premier appel qui en a besoin
		if (reste.length !== 1 || reste[0] === '') throw new ErreurCli(USAGE, 2);
		const { garder } = await import('../../infra/modeles/gardien.ts');
		return garder(resolve(reste[0]!));
	}
	if (action === 'arreter') {
		if (reste.length > 0) throw new ErreurCli(USAGE, 2);
		const racine = partiel.racine !== undefined ? partiel.racine : trouverRacine(process.cwd());
		if (racine === null) throw new ErreurCli('Aucune mémoire Mnemo ici (mnemo init).', 1);
		const resultat = await arreterServeurs(racine);
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
