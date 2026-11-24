import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Commande `mnemo` dans le terminal (macOS, Linux) : un petit script Node, `~/.local/bin/mnemo`, qui lance le `main.ts` de
 * Mnemo avec le Node de sa création (chemin absolu dans la ligne `#!` : un autre Node du PATH, trop ancien, n'est jamais
 * pris). Écrit et retiré seulement à la demande (`mnemo init`, `mnemo commande`) ; un fichier `mnemo` qui n'est pas le nôtre
 * n'est jamais touché.
 */

/** Marque de nos scripts : ce qui distingue notre `mnemo` d'une autre commande du même nom. */
export const IDENTIFIANT_COMMANDE = 'local.mnemo.commande';

export type Commande = {
	/** Node et `main.ts` appelés (chemins absolus, ceux du moment de l'écriture). */
	node: string;
	main: string;
};

/** Dossier par défaut : `~/.local/bin`, dans le PATH de la plupart des installations macOS et Linux. */
export const dossierDeCommande = (maison: string): string => join(maison, '.local', 'bin');

function script(c: Commande): string {
	return `#!${c.node}
// Commande « mnemo », écrite par Mnemo (${IDENTIFIANT_COMMANDE}) : lance le Mnemo ci-dessous avec ce Node.
// Si Node ou le code de Mnemo change de place : mnemo commande. La retirer : mnemo commande --retirer.
import(${JSON.stringify(pathToFileURL(c.main).href)});
`;
}

/** Le fichier est-il notre commande ? */
function estLaNotre(fichier: string): boolean {
	try {
		return readFileSync(fichier, 'utf8').includes(`(${IDENTIFIANT_COMMANDE})`);
	} catch {
		return false;
	}
}

/** La commande du dossier lance-t-elle déjà ce Node et ce `main.ts` ? */
export function commandeAJour(dossier: string, c: Commande): boolean {
	try {
		return readFileSync(join(dossier, 'mnemo'), 'utf8') === script(c);
	} catch {
		return false;
	}
}

/** Écrit `<dossier>/mnemo` (dossier créé s'il manque). `remplace` : une commande précédente (la nôtre) a été remplacée. */
export function ecrireCommande(dossier: string, c: Commande): { fichier: string; remplace: boolean } | { refus: string } {
	const fichier = join(dossier, 'mnemo');
	if (/\s/u.test(c.node)) return { refus: `Node est dans un chemin qui contient une espace (${c.node}) : la ligne « #! » ne le tient pas.` };
	const existe = existsSync(fichier);
	if (existe && !estLaNotre(fichier)) return { refus: `${fichier} existe et n'a pas été écrit par Mnemo : laissé en place.` };
	mkdirSync(dossier, { recursive: true });
	// écrit à côté, puis mis en place d'un coup
	const provisoire = join(dossier, `.mnemo.${process.pid}.${randomBytes(4).toString('hex')}`);
	try {
		writeFileSync(provisoire, script(c), { mode: 0o755 });
		chmodSync(provisoire, 0o755);
		renameSync(provisoire, fichier);
	} catch (erreur) {
		rmSync(provisoire, { force: true });
		throw erreur;
	}
	return { fichier, remplace: existe };
}

/** Retire `<dossier>/mnemo` s'il est le nôtre. */
export function retirerCommande(dossier: string): { retire: string } | { absent: string } | { refus: string } {
	const fichier = join(dossier, 'mnemo');
	if (!existsSync(fichier)) return { absent: fichier };
	if (!estLaNotre(fichier)) return { refus: `${fichier} n'a pas été écrit par Mnemo : laissé en place.` };
	rmSync(fichier, { force: true });
	return { retire: fichier };
}

/** Le dossier est-il dans ce PATH ? */
export function dansLePath(dossier: string, path: string | undefined): boolean {
	const vise = resolve(dossier);
	return (path ?? '').split(delimiter).some((d) => d !== '' && resolve(d) === vise);
}
