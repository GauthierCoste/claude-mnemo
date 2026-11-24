import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { deplierArchive } from './archives.ts';
import type { Piece } from './catalogue.ts';
import { telechargerFichier } from './telechargement.ts';

export type EtatPiece = { piece: Piece; installee: boolean; chemin: string };

/** Téléchargement injectable ; s'il rend une chaîne, c'est le SHA-256 calculé au fil de l'eau (sinon le fichier est relu). */
export type Telecharger = (url: string, vers: string) => Promise<string | void>;

export type OptionsInstallation = { telecharger?: Telecharger; depuis?: string };

/** `deja` : rien à faire ; `copie` : pris dans `depuis` ; `telecharge`. `ecartes` : fichiers de `depuis` à l'empreinte différente. */
export type ResultatInstallation =
	| { statut: 'deja' }
	| { statut: 'copie'; depuis: string; ecartes?: string[] }
	| { statut: 'telecharge'; ecartes?: string[] };

const MARQUEUR = '.empreinte';
const PREFIXE_TEMPORAIRE = '.tmp-';
/** Un temporaire plus vieux est un reste (Ctrl-C, panne) : un téléchargement vivant l'écrit au moins toutes les 60 s, ou abandonne. */
const AGE_RESTE_MS = 5 * 60_000;
const PROFONDEUR_DEPUIS = 2;

/** Dossier d'une pièce : `<dossier>/<nom>/<sha256[0..12]>/`. */
export function dossierPiece(dossier: string, piece: Piece): string {
	return join(dossier, piece.nom, piece.sha256.slice(0, 12));
}

async function estFichier(chemin: string): Promise<boolean> {
	try {
		return (await stat(chemin)).isFile();
	} catch {
		return false;
	}
}

async function estInstallee(dossier: string, piece: Piece): Promise<boolean> {
	const ici = dossierPiece(dossier, piece);
	try {
		const marqueur = await readFile(join(ici, MARQUEUR), 'utf8');
		if (marqueur.split('\n')[0]!.trim() !== piece.sha256) return false;
	} catch {
		return false;
	}
	return estFichier(join(ici, ...piece.fichier.split('/')));
}

/** Installée = marqueur `.empreinte` portant le SHA-256 attendu, et fichier utile présent. */
export async function etatDesPieces(dossier: string, pieces: Piece[]): Promise<EtatPiece[]> {
	return Promise.all(
		pieces.map(async (piece) => ({
			piece,
			installee: await estInstallee(dossier, piece),
			chemin: join(dossierPiece(dossier, piece), ...piece.fichier.split('/')),
		})),
	);
}

/** Fichiers nommés `nom` sous `racine`, à profondeur ≤ 2, du moins profond au plus profond ; les liens de dossiers ne sont pas suivis. */
async function chercherDans(racine: string, nom: string): Promise<string[]> {
	const trouves: string[] = [];
	let niveau = [racine];
	for (let profondeur = 0; profondeur <= PROFONDEUR_DEPUIS && niveau.length > 0; profondeur++) {
		const suivant: string[] = [];
		for (const dossier of niveau) {
			let entrees;
			try {
				entrees = await readdir(dossier, { withFileTypes: true });
			} catch {
				continue;
			}
			entrees.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
			for (const e of entrees) {
				const chemin = join(dossier, e.name);
				if (e.isDirectory()) suivant.push(chemin);
				else if (e.name === nom && (await estFichier(chemin))) trouves.push(chemin);
			}
		}
		niveau = suivant;
	}
	return trouves;
}

/** Copie `source` vers `vers` (créé) en calculant le SHA-256 de ce qui est écrit. */
async function copierEnHachant(source: string, vers: string): Promise<string> {
	const empreinte = createHash('sha256');
	await pipeline(
		createReadStream(source),
		new Transform({
			transform(morceau: Buffer, _codage, suite) {
				empreinte.update(morceau);
				suite(null, morceau);
			},
		}),
		createWriteStream(vers, { flags: 'wx', mode: 0o600 }),
	);
	return empreinte.digest('hex');
}

/** Retire les temporaires abandonnés de `<dossier>/<nom>/` (fichiers ou dossiers `.tmp-*` non modifiés depuis 5 minutes). */
async function retirerRestes(parent: string): Promise<void> {
	let noms: string[];
	try {
		noms = await readdir(parent);
	} catch {
		return;
	}
	const limite = Date.now() - AGE_RESTE_MS;
	for (const nom of noms) {
		if (!nom.startsWith(PREFIXE_TEMPORAIRE)) continue;
		const chemin = join(parent, nom);
		try {
			if ((await lstat(chemin)).mtimeMs < limite) await rm(chemin, { recursive: true, force: true });
		} catch {
			// disparu entre-temps ou illisible : rien à faire
		}
	}
}

async function hacher(chemin: string): Promise<string> {
	const empreinte = createHash('sha256');
	for await (const morceau of createReadStream(chemin)) empreinte.update(morceau as Buffer);
	return empreinte.digest('hex');
}

function messageLisible(erreur: unknown, piece: Piece, dossier: string): Error {
	const code = (erreur as { code?: unknown } | null)?.code;
	if (code === 'ENOSPC') return new Error(`Disque plein : impossible d'installer ${piece.libelle} dans ${dossier}.`);
	if (code === 'EACCES' || code === 'EPERM') return new Error(`Droits insuffisants pour écrire dans ${dossier}.`);
	return erreur instanceof Error ? erreur : new Error(String(erreur));
}

const telechargerParDefaut: Telecharger = (url, vers) => telechargerFichier(url, vers);

/**
 * Installe une pièce si elle manque. Le fichier (pris dans `depuis` ou téléchargé) arrive dans un temporaire du dossier de
 * la pièce, son SHA-256 est vérifié, puis il est déplié (ou placé) dans un dossier temporaire où `.empreinte` est écrit en
 * dernier, avant un renommage en place. Tout échec retire les temporaires.
 */
export async function installerPiece(dossier: string, piece: Piece, options: OptionsInstallation = {}): Promise<ResultatInstallation> {
	if (await estInstallee(dossier, piece)) return { statut: 'deja' };
	const parent = join(dossier, piece.nom);
	const jeton = () => `${PREFIXE_TEMPORAIRE}${randomBytes(8).toString('hex')}`;
	const fichierTemporaire = join(parent, jeton());
	const dossierTemporaire = join(parent, jeton());
	const ecartes: string[] = [];
	try {
		await mkdir(parent, { recursive: true });
		await retirerRestes(parent);

		let depuis: string | null = null;
		if (options.depuis !== undefined) {
			for (const candidat of await chercherDans(options.depuis, basename(new URL(piece.adresse).pathname))) {
				if ((await copierEnHachant(candidat, fichierTemporaire)) === piece.sha256) {
					depuis = candidat;
					break;
				}
				await rm(fichierTemporaire, { force: true });
				ecartes.push(candidat);
			}
		}
		if (depuis === null) {
			const rendu = await (options.telecharger ?? telechargerParDefaut)(piece.adresse, fichierTemporaire);
			const empreinte = typeof rendu === 'string' ? rendu : await hacher(fichierTemporaire);
			if (empreinte !== piece.sha256) throw new Error(`Empreinte différente pour ${piece.libelle} : attendue ${piece.sha256}, reçue ${empreinte}. Rien n'est installé.`);
		}

		await mkdir(dossierTemporaire);
		if (piece.archive === null) await rename(fichierTemporaire, join(dossierTemporaire, ...piece.fichier.split('/')));
		else await deplierArchive(fichierTemporaire, piece.archive, dossierTemporaire);
		const utile = join(dossierTemporaire, ...piece.fichier.split('/'));
		if (!(await estFichier(utile))) throw new Error(`Archive refusée : « ${piece.fichier} » est absent de ${piece.libelle}.`);
		if (piece.nom === 'moteur' && process.platform !== 'win32') await chmod(utile, 0o755);
		await writeFile(join(dossierTemporaire, MARQUEUR), `${piece.sha256}\n`, { mode: 0o644 });

		const final = dossierPiece(dossier, piece);
		// Jamais de suppression d'un dossier final au marqueur juste : une installation simultanée finie vaut succès (notre
		// temporaire est retiré). Un reste inachevé est d'abord mis de côté (renommé), puis retiré hors de la place finale.
		if (!(await estInstallee(dossier, piece))) {
			const decote = join(parent, jeton());
			try {
				await rename(final, decote);
			} catch {
				// absent : rien à mettre de côté
			}
			await rm(decote, { recursive: true, force: true });
			try {
				await rename(dossierTemporaire, final);
			} catch (erreur) {
				if (!(await estInstallee(dossier, piece))) throw erreur;
			}
		}
		const ecart = ecartes.length > 0 ? { ecartes } : {};
		return depuis === null ? { statut: 'telecharge', ...ecart } : { statut: 'copie', depuis, ...ecart };
	} catch (erreur) {
		throw messageLisible(erreur, piece, dossier);
	} finally {
		await rm(fichierTemporaire, { force: true });
		await rm(dossierTemporaire, { recursive: true, force: true });
	}
}
