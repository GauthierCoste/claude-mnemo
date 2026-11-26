/**
 * Le Node officiel emporté par l'app : version épinglée (`outils/version-node.txt`, la dernière 26.x au moment de l'épingler), archive de nodejs.org
 * (HTTPS) pour la cible (`darwin-<arch>.tar.gz` ; `win-x64.zip` sous Windows), somme vérifiée deux fois : par la somme
 * épinglée dans le dépôt (`outils/sommes-node.txt`, même forme que `SHASUMS256.txt`, une ligne par archive `darwin-arm64`,
 * `darwin-x64` et `win-x64` de la version épinglée) et par `SHASUMS256.txt` (téléchargé lui aussi, à chaque construction
 * s'il n'est pas en cache), qui doit donner la même somme ; cache dans `app/.cache/`. Changer de version : mettre à jour
 * `version-node.txt` et `sommes-node.txt` ensemble. Seuls le binaire (`bin/node`, ou `node.exe` à la racine de l'archive
 * Windows) et `LICENSE` sont extraits, sans outil externe (le paquet `tar` ; `zip.ts` pour Windows).
 */
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { x } from 'tar';
import type { Cible } from './cible.ts';
import { ErreurConstruction } from './erreur.ts';
import { fichiersDuZip } from './zip.ts';

const SITE = 'https://nodejs.org/dist';

/** Version épinglée lue dans le fichier (`26.13.1`, sans `v`). */
export function lireVersionNode(fichier: string): string {
	const version = readFileSync(fichier, 'utf8').trim().replace(/^v/u, '');
	if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new ErreurConstruction(`Version de Node invalide dans ${fichier} : « ${version} ».`);
	return version;
}

/** Dossier racine de l'archive officielle : `node-v26.13.1-darwin-arm64`, `node-v26.13.1-win-x64`. */
function racineArchive(version: string, cible: Cible): string {
	return `node-v${version}-${cible.plateforme === 'win32' ? 'win' : 'darwin'}-${cible.arch}`;
}

/** Nom de l'archive officielle : `node-v26.13.1-darwin-arm64.tar.gz`, `node-v26.13.1-win-x64.zip`. */
export function nomArchiveNode(version: string, cible: Cible): string {
	return `${racineArchive(version, cible)}${cible.plateforme === 'win32' ? '.zip' : '.tar.gz'}`;
}

/** Somme SHA-256 attendue pour `nom` dans un `SHASUMS256.txt` (`<somme>  <nom>` par ligne), ou `undefined`. */
export function sommeAttendue(shasums: string, nom: string): string | undefined {
	for (const ligne of shasums.split('\n')) {
		const m = /^([0-9a-f]{64}) [ *]?(\S+)$/u.exec(ligne.trim());
		if (m !== null && m[2] === nom) return m[1];
	}
	return undefined;
}

const sha256 = (donnees: Buffer): string => createHash('sha256').update(donnees).digest('hex');

async function telecharger(url: string): Promise<Buffer> {
	let reponse: Response;
	try {
		reponse = await fetch(url);
	} catch (e) {
		throw new ErreurConstruction(`Téléchargement impossible : ${url} (${e instanceof Error ? e.message : String(e)}).`);
	}
	if (!reponse.ok) throw new ErreurConstruction(`Téléchargement refusé : ${url} (HTTP ${reponse.status}).`);
	// `fetch` suit les redirections, même de HTTPS vers HTTP : la somme de SHASUMS256.txt ne vaut que reçue en HTTPS
	if (reponse.url !== '' && new URL(reponse.url).protocol !== 'https:') throw new ErreurConstruction(`Téléchargement refusé : ${url} redirigé hors HTTPS (${reponse.url}).`);
	return Buffer.from(await reponse.arrayBuffer());
}

/** Le fichier du cache, sinon téléchargé puis écrit dans le cache (écriture à côté puis renommage). */
async function enCache(cache: string, nom: string, url: string): Promise<Buffer> {
	const chemin = join(cache, nom);
	if (existsSync(chemin)) return readFileSync(chemin);
	const donnees = await telecharger(url);
	mkdirSync(cache, { recursive: true });
	writeFileSync(`${chemin}.partiel`, donnees);
	renameSync(`${chemin}.partiel`, chemin);
	return donnees;
}

/**
 * Somme d'une archive, épinglée dans le dépôt (`epinglees` : le texte de `sommes-node.txt`) : absente (version changée sans
 * ses sommes), la construction s'arrête.
 */
export function sommeEpinglee(epinglees: string, nom: string): string {
	const somme = sommeAttendue(epinglees, nom);
	if (somme === undefined) throw new ErreurConstruction(`Aucune somme épinglée pour ${nom} (outils/sommes-node.txt) : ajoutez-la avec la version.`);
	return somme;
}

/**
 * Archive vérifiée (chemin dans le cache) : sa somme doit être la somme épinglée (`epinglees`, texte de `sommes-node.txt`),
 * et `SHASUMS256.txt` doit donner la même. Une archive en cache dont la somme ne correspond pas est retéléchargée une fois ;
 * un nouvel écart arrête la construction. En cas d'échec, `SHASUMS256.txt` est aussi retiré du cache (un fichier tronqué ou
 * altéré ne bloque pas les constructions suivantes).
 */
export async function archiveNodeVerifiee(version: string, cible: Cible, cache: string, epinglees: string): Promise<string> {
	const nom = nomArchiveNode(version, cible);
	const epinglee = sommeEpinglee(epinglees, nom);
	const nomSommes = `SHASUMS256-v${version}.txt`;
	const sommes = (await enCache(cache, nomSommes, `${SITE}/v${version}/SHASUMS256.txt`)).toString('utf8');
	const attendue = sommeAttendue(sommes, nom);
	if (attendue === undefined) {
		rmSync(join(cache, nomSommes), { force: true });
		throw new ErreurConstruction(`${nom} absent de SHASUMS256.txt (v${version}).`);
	}
	if (attendue !== epinglee) {
		rmSync(join(cache, nomSommes), { force: true });
		throw new ErreurConstruction(`SHASUMS256.txt (v${version}) ne donne pas pour ${nom} la somme épinglée dans outils/sommes-node.txt : archive refusée.`);
	}
	for (let essai = 0; essai < 2; essai++) {
		const archive = await enCache(cache, nom, `${SITE}/v${version}/${nom}`);
		if (sha256(archive) === epinglee) return join(cache, nom);
		rmSync(join(cache, nom), { force: true });
	}
	rmSync(join(cache, nomSommes), { force: true });
	throw new ErreurConstruction(`Somme SHA-256 de ${nom} différente de la somme épinglée (outils/sommes-node.txt) : archive refusée.`);
}

/** Le binaire de Node dans le dossier où `extraireNode` l'a installé : `bin/node`, ou `node.exe` sous Windows. */
export function binaireNode(dossier: string, cible: Cible): string {
	return cible.plateforme === 'win32' ? join(dossier, 'node.exe') : join(dossier, 'bin', 'node');
}

/**
 * Installe le binaire de Node et `LICENSE` de l'archive dans `destination` (créé ; il ne doit pas exister) : `bin/node`
 * (0755) sous macOS, `node.exe` sous Windows. Seuls des fichiers ordinaires sont extraits : un lien (symbolique ou
 * physique) à ces noms ferait pointer le paquet hors de lui.
 */
export async function extraireNode(archive: string, version: string, cible: Cible, destination: string): Promise<void> {
	mkdirSync(join(destination, '..'), { recursive: true });
	const temporaire = mkdtempSync(join(destination, '..', '.node-'));
	try {
		const racine = join(temporaire, racineArchive(version, cible));
		if (cible.plateforme === 'win32') await extraireDuZip(archive, `${racineArchive(version, cible)}/`, racine);
		else await extraireDuTar(archive, `${racineArchive(version, cible)}/`, racine);
		renameSync(racine, destination);
	} finally {
		rmSync(temporaire, { recursive: true, force: true });
	}
}

/** `bin/node` (rendu exécutable) et `LICENSE` de l'archive `.tar.gz` (dossier `prefixe`), dans `racine`. */
async function extraireDuTar(archive: string, prefixe: string, racine: string): Promise<void> {
	const voulus = new Set([`${prefixe}bin/node`, `${prefixe}LICENSE`]);
	const ordinaire = (entree: object): boolean => ['File', 'OldFile'].includes(String((entree as { type?: unknown }).type));
	await x({ file: archive, cwd: join(racine, '..'), filter: (chemin, entree) => voulus.has(chemin.replace(/^\.\//u, '')) && ordinaire(entree) });
	const binaire = join(racine, 'bin', 'node');
	if (!existsSync(binaire) || !lstatSync(binaire).isFile()) throw new ErreurConstruction(`bin/node absent de ${archive} (ou pas un fichier ordinaire).`);
	chmodSync(binaire, 0o755);
}

/** `node.exe` et `LICENSE` de l'archive `.zip` (dossier `prefixe`), dans `racine`. */
async function extraireDuZip(archive: string, prefixe: string, racine: string): Promise<void> {
	const fichiers = await fichiersDuZip(readFileSync(archive), [`${prefixe}node.exe`, `${prefixe}LICENSE`]);
	mkdirSync(racine);
	for (const [nom, contenu] of fichiers) writeFileSync(join(racine, nom.slice(prefixe.length)), contenu);
}
