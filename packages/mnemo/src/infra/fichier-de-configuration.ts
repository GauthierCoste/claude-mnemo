import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/**
 * Un fichier de configuration de l'utilisateur chez un moteur (`hooks.json` de Codex, `config.toml` et `hooks.toml` de
 * Mistral Vibe), lu puis réécrit en entier par Mnemo, sans jamais perdre une écriture faite entre-temps.
 */

const message = (erreur: unknown): string => (erreur instanceof Error ? erreur.message : String(erreur));

/** Texte d'un fichier ; null s'il n'existe pas ; une autre erreur remonte. */
export async function texteOuAbsent(chemin: string): Promise<string | null> {
	try {
		return await readFile(chemin, 'utf8');
	} catch (erreur) {
		if ((erreur as { code?: string }).code === 'ENOENT') return null;
		throw erreur;
	}
}

/** Fichier lu : son chemin réel (où l'écrire : un lien est suivi, jamais remplacé) et son texte (null : absent). */
export type ConfigurationLue = { reel: string; texte: string | null };

/**
 * Le fichier `chemin` lu, ou l'échec qui dit pourquoi. Un lien dont la cible manque est un échec : écrire à sa place
 * remplacerait le lien.
 */
export async function lireConfiguration(chemin: string): Promise<ConfigurationLue | { echec: string }> {
	let reel = chemin;
	const lien = await lstat(chemin).then(
		(s) => s.isSymbolicLink(),
		() => false,
	);
	try {
		reel = await realpath(chemin);
	} catch (erreur) {
		if (lien) return { echec: `${chemin} est un lien symbolique dont la cible est introuvable (${message(erreur)}) : rétablir sa cible ou retirer le lien ; Mnemo ne le remplace pas.` };
		// absent : écrit à son chemin
	}
	try {
		return { reel, texte: await texteOuAbsent(reel) };
	} catch (erreur) {
		return { echec: `${chemin} illisible : ${message(erreur)}` };
	}
}

/**
 * Écrit `texte` à la place de `reel` : provisoire dans le même dossier (droits du fichier remplacé, sinon 0644), puis renommé.
 * Le fichier est relu juste avant : changé depuis la lecture (`attendu`), rien n'est écrit.
 */
export async function ecrireAtomique(reel: string, attendu: string | null, texte: string): Promise<void> {
	await mkdir(dirname(reel), { recursive: true });
	const mode = await stat(reel).then(
		(s) => s.mode & 0o777,
		() => 0o644,
	);
	const provisoire = join(dirname(reel), `.${basename(reel)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
	try {
		await writeFile(provisoire, texte, { mode, flag: 'wx' });
		if ((await texteOuAbsent(reel)) !== attendu) throw new Error(`${reel} a changé pendant l’écriture : relancer la commande.`);
		await rename(provisoire, reel);
	} finally {
		await rm(provisoire, { force: true });
	}
}

/** Écrit `texte` à la place du fichier lu (`ecrireAtomique`) ; null, ou l'échec qui dit pourquoi. */
export async function ecrireConfiguration(chemin: string, lu: ConfigurationLue, texte: string): Promise<{ echec: string } | null> {
	try {
		await ecrireAtomique(lu.reel, lu.texte, texte);
		return null;
	} catch (erreur) {
		return { echec: `écriture de ${chemin} impossible : ${message(erreur)}` };
	}
}
