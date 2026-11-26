/**
 * Assemble l'app de bureau avec `@electron/packager`, pour la plateforme de la machine (`cible.ts`), à partir du processus
 * principal construit par Vite (`dist/main.js`). Lancé par `pnpm construire-app [--dmg] [--installeur]` à la racine, après
 * la construction de l'interface et de ce paquet.
 *
 * - macOS : `dist/Mnemo.app`, architecture de la machine (pas de paquet universel), identifiant `local.mnemo.app`, icône
 *   `.icns` faite des PNG de l'interface construite (`packages/ui/dist/icones/`), signature ad hoc (identité `-` : sans
 *   elle, le paquet modifié ne se lance pas sur Apple silicon ; ou Developer ID, voir `signature.ts`). `--dmg` : produit
 *   aussi `dist/Mnemo-<version>-<arch>.dmg` (voir `dmg.ts`).
 * - Windows : `dist/Mnemo-win32-x64/` (`Mnemo.exe`), x64, icône `.ico` faite des mêmes PNG, sans signature.
 *   `--installeur` : produit aussi `dist/Mnemo-Setup-<version>-x64.exe` (voir `installeur.ts`).
 *
 * L'app est autonome : elle emporte le Node officiel (`<ressources>/node/`, voir `node-officiel.ts`) et le code de Mnemo
 * avec l'interface construite (`<ressources>/{mnemo,ui}`, voir `mnemo-deploye.ts`), que l'app lance
 * (`src/infra/emplacement.ts`) ; `<ressources>` : `Contents/Resources` sous macOS, `resources` sous Windows. La signature
 * ad hoc du packager signe aussi ces binaires (`node`, `pty.node`, `spawn-helper`).
 *
 * Outil de construction : il peut importer le code du service (`icns.ts`, du paquet `mnemo`), que l'app elle-même
 * (`src/`) n'importe jamais.
 */
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { packager } from '@electron/packager';
import { icnsDepuisPng, type TypeIcns } from '../../mnemo/src/infra/icns.ts';
import { NOM_APP } from '../src/domaine/identite-app.ts';
import { type Cible, cibleDeLaMachine, nomProduit } from './cible.ts';
import { creerDmg, nomDmg } from './dmg.ts';
import { ErreurConstruction } from './erreur.ts';
import { icoDepuisPng } from './ico.ts';
import { creerInstalleur, nomInstalleur } from './installeur.ts';
import { deployerMnemo } from './mnemo-deploye.ts';
import { archiveNodeVerifiee, extraireNode, lireVersionNode } from './node-officiel.ts';
import { optionsPlateforme } from './options-packager.ts';
import { decrireSignature, signatureDepuisEnv } from './signature.ts';

const APP = join(import.meta.dirname, '..');
const DIST = join(APP, 'dist');
/** Racine du dépôt (l’espace pnpm). */
const RACINE = join(APP, '..', '..');
const ICONES_UI = join(RACINE, 'packages', 'ui', 'dist', 'icones');
/** Archives de Node téléchargées (ignoré par git). */
const CACHE = join(APP, '.cache');
/** Ressources ajoutées à l'app (voir l'en-tête). */
const RESSOURCES = ['node', 'mnemo', 'ui'];

const lireJson = (chemin: string): Record<string, unknown> => JSON.parse(readFileSync(chemin, 'utf8')) as Record<string, unknown>;

function sortir(message: string): never {
	throw new ErreurConstruction(message);
}

function pngDeLInterface(taille: number): Buffer {
	try {
		return readFileSync(join(ICONES_UI, `icone-${taille}.png`));
	} catch {
		return sortir(`Icône absente : ${join(ICONES_UI, `icone-${taille}.png`)} (construisez l’interface : pnpm --filter @mnemo/ui construire).`);
	}
}

/** Icône de l'app : `.icns` des PNG 256, 512 et 1024 de l'interface (macOS), `.ico` du PNG 256 (Windows, 256 au plus). */
function icone(cible: Cible): { extension: string; contenu: Buffer } {
	if (cible.plateforme === 'win32') return { extension: '.ico', contenu: icoDepuisPng([{ taille: 256, png: pngDeLInterface(256) }]) };
	const entrees: { type: TypeIcns; png: Buffer }[] = [];
	for (const [type, taille] of [['ic08', 256], ['ic09', 512], ['ic10', 1024]] as const) entrees.push({ type, png: pngDeLInterface(taille) });
	return { extension: '.icns', contenu: icnsDepuisPng(entrees) };
}

/** Options reconnues : `--dmg` sous macOS, `--installeur` sous Windows. */
function verifierOptions(args: readonly string[], cible: Cible): void {
	const permise = cible.plateforme === 'darwin' ? '--dmg' : '--installeur';
	const inconnue = args.find((a) => a !== permise);
	if (inconnue === undefined) return;
	if (inconnue === '--dmg' || inconnue === '--installeur') sortir(`${inconnue} : ${inconnue === '--dmg' ? 'image disque construite sous macOS' : 'installeur construit sous Windows'} seulement.`);
	sortir(`Option inconnue : « ${inconnue} ». Usage : pnpm construire-app [--dmg] [--installeur]`);
}

/** Entrée de `dist/` à ne pas copier dans l'app : un produit d'une construction précédente, ou un dossier de travail. */
function estProduit(entree: string): boolean {
	return entree.startsWith('.') || entree.endsWith('.app') || entree.endsWith('.dmg') || entree.endsWith('.exe') || entree.startsWith(`${NOM_APP}-win32-`);
}

async function construire(args: readonly string[]): Promise<void> {
	const cible = cibleDeLaMachine(process.platform, process.arch);
	verifierOptions(args, cible);
	const signature = signatureDepuisEnv(cible.plateforme === 'darwin' ? process.env : {});
	try {
		readFileSync(join(DIST, 'main.js'));
	} catch {
		sortir(`Processus principal absent : ${join(DIST, 'main.js')} (pnpm --filter @mnemo/app construire).`);
	}
	const version = String(lireJson(join(APP, 'package.json'))['version']);
	const electron = String(lireJson(join(APP, 'node_modules', 'electron', 'package.json'))['version']);
	const versionNode = lireVersionNode(join(import.meta.dirname, 'version-node.txt'));
	const produit = join(DIST, nomProduit(cible));
	let installeur: string | null = null;

	// dans dist/ : même volume que la destination (renommage sans copie)
	const travail = mkdtempSync(join(DIST, '.construction-'));
	try {
		// Le dossier de l'app : la sortie de Vite (sans un produit déjà assemblé) et un package.json minimal, sans dépendance
		// (main.js les contient déjà).
		const source = join(travail, 'app');
		mkdirSync(source);
		for (const entree of readdirSync(DIST)) if (!estProduit(entree)) cpSync(join(DIST, entree), join(source, entree), { recursive: true });
		// sous Windows, l'éditeur et la description affichés par l'installeur et les paramètres de Windows
		const editeur = cible.plateforme === 'win32' ? { description: 'Sessions d’agents de code et leur mémoire partagée', author: NOM_APP } : {};
		writeFileSync(join(source, 'package.json'), `${JSON.stringify({ name: 'mnemo-app', productName: NOM_APP, version, private: true, type: 'module', main: 'main.js', ...editeur }, null, 2)}\n`);
		const { extension, contenu } = icone(cible);
		const fichierIcone = join(travail, `${NOM_APP}${extension}`);
		writeFileSync(fichierIcone, contenu);

		// Node officiel et code de Mnemo, ajoutés aux ressources de l'app (avant sa signature, sous macOS)
		const ressources = join(travail, 'ressources');
		const archive = await archiveNodeVerifiee(versionNode, cible, CACHE, readFileSync(join(import.meta.dirname, 'sommes-node.txt'), 'utf8'));
		await extraireNode(archive, versionNode, cible, join(ressources, 'node'));
		deployerMnemo(RACINE, join(RACINE, 'packages'), ressources, cible);

		const [chemin] = await packager({
			dir: source,
			out: join(travail, 'sortie'),
			name: NOM_APP,
			executableName: NOM_APP,
			appVersion: version,
			buildVersion: version,
			electronVersion: electron,
			icon: fichierIcone,
			// aucun lien dans ces dossiers (vérifié par `deployerMnemo`) : copiés tels quels
			extraResource: RESSOURCES.map((nom) => join(ressources, nom)),
			asar: true,
			prune: false,
			overwrite: true,
			quiet: true,
			...optionsPlateforme(cible, signature),
		});
		if (chemin === undefined) sortir('@electron/packager n’a rien produit.');
		rmSync(produit, { recursive: true, force: true });
		renameSync(cible.plateforme === 'darwin' ? join(chemin, basename(produit)) : chemin, produit);

		if (args.includes('--installeur')) {
			const fait = await creerInstalleur(produit, source, version, electron, fichierIcone, join(travail, 'installeur'));
			installeur = join(DIST, nomInstalleur(version));
			rmSync(installeur, { force: true });
			renameSync(fait, installeur);
		}
	} finally {
		rmSync(travail, { recursive: true, force: true });
	}
	console.log(`Construit : ${produit}`);
	if (cible.plateforme === 'win32') {
		if (installeur !== null) console.log(`Installeur : ${installeur}`);
		return;
	}
	console.log(decrireSignature(signature));
	if (args.includes('--dmg')) {
		const dmg = join(DIST, nomDmg(NOM_APP, version, cible.arch));
		creerDmg(produit, dmg, `${NOM_APP} ${version}`);
		console.log(`Image disque : ${dmg}`);
	}
	console.log('L’installer : ouvrir l’app (son assistant s’en charge), ou « pnpm installer-dev <dossier Mnemo> » (copie dans ~/Applications et configuration, sans assistant).');
}

try {
	await construire(process.argv.slice(2));
} catch (erreur) {
	if (!(erreur instanceof ErreurConstruction)) throw erreur;
	console.error(erreur.message);
	process.exitCode = 1;
}
