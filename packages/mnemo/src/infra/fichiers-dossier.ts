import { constants } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { link, lstat, mkdir, open, readdir, rm, statfs, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { nomDeFichierNouveauValide, TAILLE_MAX_DOCUMENT, tailleLisible } from '@mnemo/commun';
import { ErreurFichier } from '../application/ports.ts';
import type { DocumentOuvert, Fichiers } from '../application/ports.ts';
import { cheminDeLaRacine, DOSSIER_CLAUDE } from '../domaine/chemin.ts';
import { DOSSIER_LOCAL } from '../domaine/dossier-memoire.ts';
import { hacheurOctets } from '../domaine/empreinte.ts';

export const tropVolumineux = (chemin: string, max = TAILLE_MAX_DOCUMENT): string => `Document trop volumineux : « ${chemin} » (plus de ${tailleLisible(max)}).`;

/** Dépôt refusé parce qu'il dépasse la taille permise (constaté en cours d'envoi) : 413 pour le service. */
export class ErreurTropVolumineux extends ErreurFichier {
	constructor(message: string) {
		super(message);
		this.name = 'ErreurTropVolumineux';
	}
}

/**
 * Document ouvert sur un descripteur : chaque lecture vérifie que le fichier n'a changé ni de taille ni de date depuis
 * l'ouverture (sinon une erreur : l'empreinte et l'extraction porteraient sur deux contenus différents).
 */
function documentOuvert(fichier: FileHandle, chemin: string, taille: number, mtimeMs: number): DocumentOuvert {
	let ferme = false;
	return {
		taille,
		async lire(position, longueur) {
			const fin = Math.min(taille, position + longueur);
			if (position >= fin) return new Uint8Array(0);
			const tampon = new Uint8Array(fin - position);
			let lus = 0;
			while (lus < tampon.length) {
				const { bytesRead } = await fichier.read(tampon, lus, tampon.length - lus, position + lus);
				if (bytesRead === 0) break;
				lus += bytesRead;
			}
			const etat = await fichier.stat();
			if (lus < tampon.length || etat.size !== taille || etat.mtimeMs !== mtimeMs) throw new Error(`Le document « ${chemin} » a changé pendant sa lecture.`);
			return tampon;
		},
		async fermer() {
			if (ferme) return;
			ferme = true;
			await fichier.close();
		},
	};
}

/** Segments d'un chemin de document accepté par `cheminDeLaRacine` (la racine elle-même n'est pas un document), sinon une `ErreurFichier` qui dit pourquoi. */
function segmentsDe(chemin: string): string[] {
	const r = cheminDeLaRacine(chemin);
	if (!r.ok) throw new ErreurFichier(`Chemin de document refusé : « ${chemin} » (${r.motif}).`);
	if (r.chemin === '') throw new ErreurFichier(`Chemin de document refusé : « ${chemin} » (relatif à la racine du dossier Mnemo attendu).`);
	return r.chemin.split('/');
}

/** `claudeGlobal` : dossier de configuration globale de Claude Code (`~/.claude` par défaut), jamais lu ici (`mnemo amorce` s'en charge). */
export type OptionsFichiersDossier = { claudeGlobal?: string };

/**
 * Documents du dossier Mnemo, en lecture seule. Chaque segment est examiné sans suivre les liens : un lien symbolique, où
 * qu'il soit dans le chemin, est refusé (il pourrait mener hors du dossier). Un dossier Mnemo placé à la racine du dossier
 * personnel ne donne pas accès à `~/.claude` : ce dossier global est refusé.
 */
export function fichiersDossier(racineDossier: string, options: OptionsFichiersDossier = {}): Fichiers {
	const racine = resolve(racineDossier);
	// comparé sans casse : sur un disque insensible à la casse, « .Claude » est le même dossier
	const global = resolve(options.claudeGlobal ?? join(homedir(), DOSSIER_CLAUDE)).toLowerCase();

	function segmentsAcceptes(chemin: string): string[] {
		const segments = segmentsDe(chemin);
		const absolu = join(racine, ...segments).toLowerCase();
		if (absolu === global || absolu.startsWith(global + sep)) {
			throw new ErreurFichier(`Chemin de document refusé : « ${chemin} » (configuration globale de Claude Code, ~/.claude : déjà amorcée par mnemo amorce).`);
		}
		return segments;
	}

	/** Chemin absolu d'un fichier ordinaire, null s'il n'existe pas ; refuse liens symboliques et non-fichiers. */
	async function verifier(chemin: string): Promise<{ absolu: string; mtimeMs: number; taille: number; ino: number; dev: number } | null> {
		const segments = segmentsAcceptes(chemin);
		let courant = racine;
		for (const [i, segment] of segments.entries()) {
			courant = join(courant, segment);
			let info;
			try {
				info = await lstat(courant);
			} catch (erreur) {
				const code = (erreur as NodeJS.ErrnoException).code;
				if (code === 'ENOENT' || code === 'ENOTDIR') return null;
				throw erreur;
			}
			if (info.isSymbolicLink()) throw new ErreurFichier(`Chemin de document refusé : « ${chemin} » (lien symbolique).`);
			const dernier = i === segments.length - 1;
			if (dernier && !info.isFile()) throw new ErreurFichier(`Chemin de document refusé : « ${chemin} » (ce n'est pas un fichier).`);
			if (!dernier && !info.isDirectory()) return null;
			if (dernier) return { absolu: courant, mtimeMs: info.mtimeMs, taille: info.size, ino: info.ino, dev: info.dev };
		}
		return null;
	}

	return {
		async etat(chemin) {
			const v = await verifier(chemin);
			return v === null ? null : { mtimeMs: v.mtimeMs, taille: v.taille };
		},

		async cheminReel(chemin) {
			if ((await verifier(chemin)) === null) return null;
			const reels: string[] = [];
			let courant = racine;
			for (const segment of segmentsAcceptes(chemin)) {
				const noms = await readdir(courant);
				const cle = segment.normalize('NFC').toLowerCase();
				const reel = noms.find((n) => n === segment) ?? noms.find((n) => n.normalize('NFC').toLowerCase() === cle);
				if (reel === undefined) return null;
				reels.push(reel);
				courant = join(courant, reel);
			}
			return reels.join('/');
		},

		async ouvrir(chemin) {
			const v = await verifier(chemin);
			if (v === null) return null;
			if (v.taille > TAILLE_MAX_DOCUMENT) throw new ErreurFichier(tropVolumineux(chemin));
			let fichier: FileHandle;
			try {
				// O_NOFOLLOW : un lien posé à la place du fichier entre l'examen et l'ouverture est refusé (sauf Windows, sans ce drapeau).
				fichier = await open(v.absolu, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
			} catch (erreur) {
				const code = (erreur as NodeJS.ErrnoException).code;
				if (code === 'ENOENT') return null;
				if (code === 'ELOOP') throw new ErreurFichier(`Chemin de document refusé : « ${chemin} » (lien symbolique).`);
				throw erreur;
			}
			try {
				// Le fichier ouvert doit être celui examiné (même inode), ordinaire, et pas plus gros que la limite.
				const ouvert = await fichier.stat();
				if (!ouvert.isFile() || ouvert.ino !== v.ino || ouvert.dev !== v.dev) throw new ErreurFichier(`Chemin de document refusé : « ${chemin} » (remplacé pendant la lecture).`);
				if (ouvert.size > TAILLE_MAX_DOCUMENT) throw new ErreurFichier(tropVolumineux(chemin));
				return documentOuvert(fichier, chemin, ouvert.size, ouvert.mtimeMs);
			} catch (erreur) {
				await fichier.close();
				throw erreur;
			}
		},
	};
}

/** Dossier des dépôts en cours (`.mnemo/depots/`) : vidé au démarrage du service, seul à y écrire. */
export const dossierDepots = (racineDossier: string): string => join(resolve(racineDossier), DOSSIER_LOCAL, 'depots');

/** Codes d'un lien dur impossible (exFAT, FAT, certains partages SMB ; autre volume) : repli sur une copie exclusive. */
const LIEN_IMPOSSIBLE = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV', 'EMLINK']);
/** Codes d'un disque plein (ou d'un quota atteint). */
const DISQUE_PLEIN = new Set(['ENOSPC', 'EDQUOT']);

/** Dépôt refusé faute de place sur le disque (annoncée ou constatée en cours d'écriture) : 507 pour le service. */
export class ErreurEspaceInsuffisant extends ErreurFichier {
	constructor(message: string) {
		super(message);
		this.name = 'ErreurEspaceInsuffisant';
	}
}

/** Octets libres sur le volume de `dossier` (pour un utilisateur ordinaire), ou null s'ils ne se lisent pas. */
async function espaceLibre(dossier: string): Promise<number | null> {
	try {
		const s = await statfs(dossier);
		return s.bavail * s.bsize;
	} catch {
		return null;
	}
}

/** Refus (`ErreurEspaceInsuffisant`) d'un dépôt de `taille` octets qui ne tient pas sur le volume de `dossier`. */
export async function verifierPlace(dossier: string, chemin: string, taille: number | null): Promise<void> {
	if (taille === null) return;
	const libre = await espaceLibre(dossier);
	if (libre !== null && taille > libre) {
		throw new ErreurEspaceInsuffisant(`Place insuffisante sur le disque pour « ${chemin} » : ${tailleLisible(taille)} à écrire, ${tailleLisible(libre)} libres.`);
	}
}

/**
 * Examine la cible d'un dépôt : mêmes règles que la lecture (`segmentsDe` : relatif, hors `_mnemo/` et `.mnemo/` ; aucun lien
 * symbolique dans le chemin) ; chaque dossier manquant suit `nomDeFichierNouveauValide`. `creer` : dossiers manquants créés (sinon, un dossier manquant laisse la cible libre).
 * Rend le chemin absolu, ou `existe` (fichier, dossier ou lien déjà là). Refus : `ErreurFichier`.
 */
async function cibleDuDepot(racineDossier: string, chemin: string, creer: boolean): Promise<{ absolu: string } | 'existe'> {
	const segments = segmentsDe(chemin);
	// tous les noms à créer sont contrôlés avant le premier `mkdir` : un refus ne laisse aucun dossier derrière lui
	if (creer) await cibleDuDepot(racineDossier, chemin, false);
	let courant = resolve(racineDossier);
	let manquant = false;
	// un dossier manquant est créé par le dépôt : son nom suit la règle d'un nom nouveau
	const nouveau = (segment: string): void => {
		const r = nomDeFichierNouveauValide(segment);
		if (!r.ok) throw new ErreurFichier(`Chemin de document refusé : « ${chemin} » (dossier à créer : ${r.motif}).`);
	};
	for (const segment of segments.slice(0, -1)) {
		courant = join(courant, segment);
		if (manquant) {
			nouveau(segment);
			continue;
		}
		let info;
		try {
			info = await lstat(courant);
		} catch (erreur) {
			if ((erreur as NodeJS.ErrnoException).code !== 'ENOENT') throw erreur;
			nouveau(segment);
			if (!creer) {
				manquant = true;
				continue;
			}
			await mkdir(courant).catch((e: NodeJS.ErrnoException) => {
				if (e.code !== 'EEXIST') throw e;
			});
			info = await lstat(courant);
		}
		if (info.isSymbolicLink()) throw new ErreurFichier(`Chemin de document refusé : « ${chemin} » (lien symbolique).`);
		if (!info.isDirectory()) throw new ErreurFichier(`Chemin de document refusé : « ${chemin} » (« ${segment} » n'est pas un dossier).`);
	}
	const absolu = join(courant, segments.at(-1)!);
	if (manquant) return { absolu };
	const present = await lstat(absolu).then(
		() => true,
		(e: NodeJS.ErrnoException) => (e.code === 'ENOENT' ? false : Promise.reject(e)),
	);
	return present ? 'existe' : { absolu };
}

/**
 * Vérifie un dépôt avant son envoi (l'interface, sans corps) : chemin accepté, fichier absent, et `taille` octets (si
 * donnée) qui tiennent sur le disque. `existe`, sinon `libre` ; refus : `ErreurFichier` (`ErreurEspaceInsuffisant`).
 * Rien n'est créé. Le dépôt lui-même revérifie tout (un fichier apparu entre-temps n'est jamais remplacé).
 */
export async function verifierDepot(racineDossier: string, chemin: string, taille: number | null): Promise<'libre' | 'existe'> {
	if ((await cibleDuDepot(racineDossier, chemin, false)) === 'existe') return 'existe';
	await verifierPlace(resolve(racineDossier), chemin, taille);
	return 'libre';
}

/**
 * Vide le dossier des dépôts en cours (`dossierDepots`) : au démarrage du service, ce qui s'y trouve vient d'un dépôt
 * interrompu par un arrêt brutal (le service est seul à y écrire). Rend le nombre de temporaires retirés.
 */
export async function nettoyerDepots(racineDossier: string): Promise<number> {
	const dossier = dossierDepots(racineDossier);
	let noms: string[];
	try {
		noms = await readdir(dossier);
	} catch {
		return 0;
	}
	let retires = 0;
	for (const nom of noms) {
		await rm(join(dossier, nom), { force: true, recursive: true }).then(
			() => retires++,
			() => {},
		);
	}
	return retires;
}

/** Copie `source` dans `destination` (ouvert), par morceaux de 4 Mo, puis l'écrit sur le disque. */
async function copierDans(source: string, destination: FileHandle): Promise<void> {
	const lecteur = await open(source, constants.O_RDONLY);
	try {
		const tampon = new Uint8Array(4 * 1024 * 1024);
		for (;;) {
			const { bytesRead } = await lecteur.read(tampon, 0, tampon.length, null);
			if (bytesRead === 0) break;
			let ecrits = 0;
			while (ecrits < bytesRead) ecrits += (await destination.write(tampon, ecrits, bytesRead - ecrits)).bytesWritten;
		}
		await destination.sync();
	} finally {
		await lecteur.close();
	}
}

/** `annonce` : taille annoncée du corps ; `lier` (tests) : le lien dur du temporaire sous son nom final. */
export type OptionsDepot = { annonce?: number | null; lier?: (de: string, vers: string) => Promise<void> };

/**
 * Dépose un fichier dans le dossier Mnemo (dépôt de l'interface), aux règles de `cibleDuDepot`. Le corps arrive en flux
 * (`flux`) et n'est jamais gardé en entier en mémoire : il est écrit dans un temporaire de `.mnemo/depots/` (nom aléatoire,
 * création exclusive), puis lié sous son nom (lien exclusif : jamais d'écrasement) et le temporaire retiré. Si le lien est
 * impossible (exFAT, SMB, autre volume), le nom final est créé de façon exclusive et le temporaire y est copié (jamais
 * d'écrasement non plus).
 * `annonce` : taille annoncée (Content-Length), refusée d'emblée si elle ne tient pas sur le disque. Au-delà de `max`
 * octets, `ErreurTropVolumineux` dès le dépassement ; disque plein, `ErreurEspaceInsuffisant` ; flux interrompu ou en
 * erreur : son erreur. Dans tous les cas le temporaire est retiré et rien ne reste. `existe` si le fichier est déjà là,
 * avant comme après l'envoi (rien n'est touché). Refus de chemin : `ErreurFichier`. Écrit : l'`empreinte` des octets
 * reçus, calculée pendant le flux (le fichier n'est jamais relu).
 */
export async function deposerFichier(
	racineDossier: string,
	chemin: string,
	flux: AsyncIterable<Uint8Array>,
	max = TAILLE_MAX_DOCUMENT,
	options: OptionsDepot = {},
): Promise<{ empreinte: string } | 'existe'> {
	const cible = await cibleDuDepot(racineDossier, chemin, true);
	// déjà là : rien n'est lu ni écrit
	if (cible === 'existe') return 'existe';
	const { absolu } = cible;
	const depots = dossierDepots(racineDossier);
	await mkdir(depots, { recursive: true, mode: 0o700 });
	await verifierPlace(depots, chemin, options.annonce ?? null);
	const plein = (): ErreurEspaceInsuffisant => new ErreurEspaceInsuffisant(`Disque plein : « ${chemin} » n'a pas pu être écrit en entier (rien n'est gardé).`);
	// nom aléatoire, sans rien du nom déposé : jamais trop long, jamais prévisible
	const temporaire = join(depots, `${randomBytes(12).toString('hex')}.depot`);
	// création exclusive du temporaire : jamais un fichier ou un lien existant suivi
	const hacheur = hacheurOctets();
	const fichier = await open(temporaire, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o644);
	let ferme = false;
	try {
		try {
			let recus = 0;
			for await (const morceau of flux) {
				recus += morceau.byteLength;
				if (recus > max) throw new ErreurTropVolumineux(tropVolumineux(chemin, max));
				hacheur.ajouter(morceau);
				let ecrits = 0;
				while (ecrits < morceau.byteLength) ecrits += (await fichier.write(morceau, ecrits, morceau.byteLength - ecrits)).bytesWritten;
			}
			await fichier.sync();
			await fichier.close();
			ferme = true;
		} catch (erreur) {
			if (DISQUE_PLEIN.has((erreur as NodeJS.ErrnoException).code ?? '')) throw plein();
			throw erreur;
		}
		try {
			// lien exclusif : un fichier apparu entre-temps sous ce nom n'est jamais remplacé
			await (options.lier ?? link)(temporaire, absolu);
			return { empreinte: hacheur.resultat() };
		} catch (erreur) {
			const code = (erreur as NodeJS.ErrnoException).code ?? '';
			if (code === 'EEXIST') return 'existe';
			if (!LIEN_IMPOSSIBLE.has(code)) throw erreur;
		}
		// lien impossible sur ce volume : nom final créé de façon exclusive, puis le temporaire y est copié. Limite connue
		// (docs/references/document-limits.md) : un arrêt brutal pendant la copie laisse le fichier final tronqué ; ces volumes
		// n'ont pas de renommage sans écrasement, la copie ne peut donc pas passer par un nom caché d'abord.
		let final: FileHandle;
		try {
			final = await open(absolu, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o644);
		} catch (erreur) {
			if ((erreur as NodeJS.ErrnoException).code === 'EEXIST') return 'existe';
			throw erreur;
		}
		try {
			await copierDans(temporaire, final);
			await final.close();
			return { empreinte: hacheur.resultat() };
		} catch (erreur) {
			// créé ici même (exclusif), incomplet : retiré
			await final.close().catch(() => {});
			await unlink(absolu).catch(() => {});
			if (DISQUE_PLEIN.has((erreur as NodeJS.ErrnoException).code ?? '')) throw plein();
			throw erreur;
		}
	} finally {
		if (!ferme) await fichier.close().catch(() => {});
		await unlink(temporaire).catch(() => {});
	}
}
