import { randomBytes } from 'node:crypto';
import { chmodSync, lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOSSIER_LOCAL } from '../domaine/dossier-memoire.ts';

/**
 * Jeton du service d'un dossier Mnemo, gardé dans `.mnemo/jeton` (droits 0600) : créé une fois, repris à chaque démarrage,
 * pour que l'adresse de l'interface et le jeton gardé par le navigateur restent valables. `mnemo jeton --renouveler`
 * le remplace. `.mnemo/` doit exister (`preparerDossierLocal`).
 */

const FORME = /^[0-9a-f]{64}$/u;
const POSIX = process.platform !== 'win32';

const fichierJeton = (racine: string) => join(racine, DOSSIER_LOCAL, 'jeton');

/** Écrit un jeton neuf (32 octets aléatoires, hexadécimal) de façon atomique, droits 0600 ; un lien symbolique est remplacé, jamais suivi. */
function ecrireJetonNeuf(racine: string): string {
	const jeton = randomBytes(32).toString('hex');
	const temporaire = join(racine, DOSSIER_LOCAL, `jeton.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
	// `wx` : jamais un fichier existant (ni un lien posé là d'avance)
	writeFileSync(temporaire, `${jeton}\n`, { mode: 0o600, flag: 'wx' });
	try {
		// le mode de création passe par le masque de l'utilisateur : imposé ensuite
		chmodSync(temporaire, 0o600);
		renameSync(temporaire, fichierJeton(racine));
	} catch (erreur) {
		try {
			unlinkSync(temporaire);
		} catch {
			// déjà parti
		}
		throw erreur;
	}
	return jeton;
}

/** Le jeton gardé s'il est sain, sinon la raison de le remplacer (`null` : il n'existe pas encore). */
function lireJetonGarde(racine: string): { jeton: string } | { raison: string | null } {
	const fichier = fichierJeton(racine);
	let infos;
	try {
		infos = lstatSync(fichier);
	} catch (erreur) {
		if ((erreur as NodeJS.ErrnoException).code === 'ENOENT') return { raison: null };
		return { raison: 'illisible' };
	}
	if (!infos.isFile()) return { raison: 'pas un fichier ordinaire (lien symbolique ?)' };
	if (POSIX) {
		if (typeof process.getuid === 'function' && infos.uid !== process.getuid()) return { raison: 'appartient à un autre utilisateur' };
		// lisible par d'autres : il a pu être lu, on n'y fie plus
		if ((infos.mode & 0o077) !== 0) return { raison: 'droits trop larges (lisible par d’autres utilisateurs)' };
	}
	let contenu: string;
	try {
		contenu = readFileSync(fichier, 'utf8').trim();
	} catch {
		return { raison: 'illisible' };
	}
	return FORME.test(contenu) ? { jeton: contenu } : { raison: 'de mauvaise forme' };
}

/**
 * Le jeton du dossier : celui de `.mnemo/jeton`, ou un neuf s'il n'existe pas. Un jeton illisible, de mauvaise forme, lisible
 * par d'autres ou qui n'est pas un fichier ordinaire est remplacé, et `avertir` le dit (sans jamais écrire de jeton).
 */
export function jetonDuDossier(racine: string, avertir: (message: string) => void): string {
	const lu = lireJetonGarde(racine);
	if ('jeton' in lu) return lu.jeton;
	const neuf = ecrireJetonNeuf(racine);
	if (lu.raison !== null) avertir(`jeton de .mnemo/jeton ${lu.raison} : remplacé par un neuf (les navigateurs devront rouvrir l’adresse avec jeton).`);
	return neuf;
}

/** Remplace le jeton du dossier par un neuf et le rend. */
export function renouvelerJeton(racine: string): string {
	return ecrireJetonNeuf(racine);
}
