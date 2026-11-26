/**
 * Le code de Mnemo (paquets voisins de ce dépôt) emporté par l'app, dans un dossier de ressources :
 *
 * - `mnemo/` : `packages/mnemo` et ses dépendances de production (`pnpm deploy --prod`, `node_modules` à plat :
 *   `node-linker=hoisted`), dont `node-pty` (précompilé N-API pour la cible, seul gardé), sans les dossiers de tests des
 *   dépendances (`dossiersDeTest`) ;
 * - `mnemo/node_modules/@mnemo/{commun,contrat}` : ces deux paquets traduits en JavaScript (`paquet-js.ts` : Node refuse le
 *   TypeScript situé sous `node_modules`) ;
 * - `ui/dist` : l'interface construite, là où `adaptateurs/http/statique.ts` la cherche (`../../../../ui/dist` depuis le
 *   fichier), sans `MNEMO_UI_DIST`.
 *
 * Aucun lien symbolique dans l'arbre (vérifié à la fin) : l'installeur Windows ne les garde pas, et Node résout tout par
 * ses `node_modules` ordinaires, sous macOS comme sous Windows.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Cible } from './cible.ts';
import { ErreurConstruction } from './erreur.ts';
import { ecrirePaquetJs } from './paquet-js.ts';

/** Paquets du dépôt emportés traduits (leur nom de dossier sous `packages/`). */
const PAQUETS_DU_DEPOT: Readonly<Record<string, string>> = { '@mnemo/commun': 'commun', '@mnemo/contrat': 'contrat' };

/** Fichiers de `packages/mnemo` inutiles à l'exécution (tests, configuration des outils, traces de `pnpm deploy`). */
const RETIRES_MNEMO = ['tests', 'vitest.config.ts', 'tsconfig.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.gitattributes'];
/** Métadonnées de pnpm sous `node_modules` (elles nomment le dépôt de la machine qui construit). */
const RETIRES_MODULES = ['.modules.yaml', '.pnpm-workspace-state-v1.json', '.pnpm'];

const lireJson = (chemin: string): Record<string, unknown> => JSON.parse(readFileSync(chemin, 'utf8')) as Record<string, unknown>;

/**
 * Comment lancer `pnpm`, d'après `npm_execpath` (le pnpm qui lance la construction) : un script (`.cjs`, `.mjs`, `.js`) par
 * le Node courant, un exécutable (`.exe`) directement ; sans lui, `pnpm` du `PATH`, sauf sous Windows où c'est un script
 * `.cmd`, que seul un shell lance (arguments à citer pour cmd.exe) : la construction demande alors d'être lancée par
 * `pnpm construire-app`. Jamais de shell.
 */
export function commandePnpm(execpath: string | undefined, plateforme: NodeJS.Platform, node: string): { commande: string; debut: string[] } {
	if (execpath !== undefined && /\.[cm]?js$/iu.test(execpath)) return { commande: node, debut: [execpath] };
	if (execpath !== undefined && /\.exe$/iu.test(execpath)) return { commande: execpath, debut: [] };
	if (plateforme === 'win32') throw new ErreurConstruction('pnpm introuvable pour la construction : lancez-la par « pnpm construire-app » (npm_execpath absent ou inattendu).');
	return { commande: 'pnpm', debut: [] };
}

function pnpm(args: string[], cwd: string): void {
	const { commande, debut } = commandePnpm(process.env['npm_execpath'], process.platform, process.execPath);
	try {
		execFileSync(commande, [...debut, ...args], { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
	} catch (e) {
		const sortie = (e as { stderr?: Buffer }).stderr?.toString('utf8').trim();
		throw new ErreurConstruction(`pnpm ${args.join(' ')} a échoué${sortie ? ` : ${sortie}` : '.'}`);
	}
}

/**
 * Dépendances d'un `package.json` (le texte JSON lu) vers les paquets du dépôt (`workspace:` dans le dépôt ; `pnpm deploy`
 * les réécrit en `<nom>@file://<chemin absolu de la machine>`), réécrites à leur version (`versions`) : plus rien ne nomme la
 * machine qui construit. Toute autre dépendance locale (`workspace:`, `file:`, `link:`) arrête la construction.
 */
export function dependancesSansChemin(paquet: Record<string, unknown>, versions: Readonly<Record<string, string>>, nomFichier: string): Record<string, string> {
	const deps = { ...((paquet['dependencies'] ?? {}) as Record<string, string>) };
	for (const [nom, valeur] of Object.entries(deps)) {
		const duDepot = versions[nom];
		if (duDepot !== undefined) deps[nom] = duDepot;
		else if (/(^|@)(workspace|file|link):/u.test(valeur)) throw new ErreurConstruction(`Dépendance locale inattendue : ${nom} (${nomFichier}).`);
	}
	return deps;
}

/**
 * Précompilés de node-pty à garder pour la cible (dossier `prebuilds/<plateforme>-<arch>`) et fichiers exigés : sous macOS,
 * `pty.node` et `spawn-helper` (rendu exécutable : le paquet est signé) ; sous Windows, `pty.node` et `conpty.node` (ConPTY),
 * sans les symboles de débogage (`.pdb`).
 */
export function precompilesNodePty(cible: Cible): { dossier: string; exiges: string[] } {
	const dossier = `${cible.plateforme}-${cible.arch}`;
	return cible.plateforme === 'darwin' ? { dossier, exiges: ['pty.node', 'spawn-helper'] } : { dossier, exiges: ['pty.node', 'conpty.node'] };
}

/** Garde seulement les précompilés de node-pty de la cible (voir `precompilesNodePty`). */
export function elaguerNodePty(racine: string, cible: Cible): void {
	if (!existsSync(join(racine, 'prebuilds'))) throw new ErreurConstruction('node-pty absent du déploiement de Mnemo.');
	const { dossier: gardes, exiges } = precompilesNodePty(cible);
	for (const dossier of readdirSync(join(racine, 'prebuilds'))) if (dossier !== gardes) rmSync(join(racine, 'prebuilds', dossier), { recursive: true });
	for (const dossier of ['deps', 'third_party', 'src', 'scripts']) rmSync(join(racine, dossier), { recursive: true, force: true });
	const prebuilds = join(racine, 'prebuilds', gardes);
	for (const fichier of exiges) if (!existsSync(join(prebuilds, fichier))) throw new ErreurConstruction(`Précompilé de node-pty absent pour ${gardes} : ${fichier}.`);
	if (cible.plateforme === 'darwin') chmodSync(join(prebuilds, 'spawn-helper'), 0o755);
	else for (const f of readdirSync(prebuilds, { recursive: true }) as string[]) if (f.endsWith('.pdb')) rmSync(join(prebuilds, f));
}

/** Retire tous les dossiers `.bin` (liens ou scripts vers les commandes des dépendances, inutiles à l'exécution) sous `modules`. */
function retirerBin(modules: string): void {
	for (const entree of readdirSync(modules, { recursive: true }) as string[]) {
		if (basename(entree) === '.bin' && existsSync(join(modules, entree))) rmSync(join(modules, entree), { recursive: true, force: true });
	}
}

/** Noms des dossiers de tests d'un paquet. */
const DOSSIERS_DE_TEST = new Set(['test', 'tests', '__tests__']);

/**
 * Dossiers de tests à la racine des paquets de `modules` (`node_modules/<paquet>/test`, `node_modules/@portee/<paquet>/tests`…),
 * que ni le point d'entrée, ni les exports, ni les commandes du paquet ne nomment : inutiles à l'exécution, ils allongent les
 * chemins (limite de 260 caractères de certains outils Windows) et alourdissent l'app.
 */
export function dossiersDeTest(modules: string): string[] {
	const trouves: string[] = [];
	for (const entree of readdirSync(modules, { recursive: true }) as string[]) {
		const nom = basename(entree);
		if (!DOSSIERS_DE_TEST.has(nom)) continue;
		const chemin = join(modules, entree);
		const paquet = dirname(chemin);
		const parent = dirname(paquet);
		const racine = basename(parent) === 'node_modules' || (basename(parent).startsWith('@') && basename(dirname(parent)) === 'node_modules');
		if (!racine || !lstatSync(chemin).isDirectory() || !existsSync(join(paquet, 'package.json'))) continue;
		const json = lireJson(join(paquet, 'package.json'));
		const references = JSON.stringify(['main', 'module', 'exports', 'imports', 'browser', 'bin'].map((cle) => json[cle] ?? null));
		if (new RegExp(`(^|[^\\w-])${nom}([^\\w-]|$)`, 'u').test(references)) continue;
		trouves.push(chemin);
	}
	return trouves;
}

/** Aucun lien symbolique sous `dossier` (ni jonction) : l'installeur Windows ne les garde pas, le paquet se suffit. */
export function verifierSansLien(dossier: string): void {
	for (const entree of readdirSync(dossier, { recursive: true }) as string[]) {
		if (lstatSync(join(dossier, entree)).isSymbolicLink()) throw new ErreurConstruction(`Lien refusé dans le paquet : ${join(dossier, entree)}.`);
	}
}

/**
 * Remplit `ressources/` (qui ne doit pas encore contenir `mnemo/`) : voir l'en-tête. `espace` : la racine de l'espace pnpm
 * qui contient les paquets de Mnemo (ce dépôt) ; `paquets` : le dossier `packages/` du dépôt ; `cible` : celle de l'app.
 */
export function deployerMnemo(espace: string, paquets: string, ressources: string, cible: Cible): void {
	const ui = join(paquets, 'ui', 'dist');
	if (!existsSync(join(ui, 'index.html'))) throw new ErreurConstruction(`Interface non construite : ${ui} (pnpm --filter @mnemo/ui construire).`);
	mkdirSync(ressources, { recursive: true });
	const mnemo = join(ressources, 'mnemo');
	const modules = join(mnemo, 'node_modules');
	pnpm(['deploy', '--prod', '--config.node-linker=hoisted', '--filter', 'mnemo', mnemo], espace);
	for (const f of RETIRES_MNEMO) rmSync(join(mnemo, f), { recursive: true, force: true });
	for (const f of RETIRES_MODULES) rmSync(join(modules, f), { recursive: true, force: true });
	retirerBin(modules);

	// paquets du dépôt : la copie de `pnpm deploy` (TypeScript, tests compris) remplacée par la traduction en JavaScript
	const versions = Object.fromEntries(Object.entries(PAQUETS_DU_DEPOT).map(([nom, dossier]) => [nom, String(lireJson(join(paquets, dossier, 'package.json'))['version'])]));
	for (const [nom, dossier] of Object.entries(PAQUETS_DU_DEPOT)) {
		const source = join(paquets, dossier);
		const destination = join(modules, ...nom.split('/'));
		rmSync(destination, { recursive: true, force: true });
		ecrirePaquetJs(source, destination, dependancesSansChemin(lireJson(join(source, 'package.json')), versions, join(source, 'package.json')));
	}
	const paquetMnemo = lireJson(join(mnemo, 'package.json'));
	paquetMnemo['dependencies'] = dependancesSansChemin(paquetMnemo, versions, join(mnemo, 'package.json'));
	writeFileSync(join(mnemo, 'package.json'), `${JSON.stringify(paquetMnemo, null, 2)}\n`);

	elaguerNodePty(join(modules, 'node-pty'), cible);
	for (const dossier of dossiersDeTest(modules)) rmSync(dossier, { recursive: true, force: true });
	cpSync(ui, join(ressources, 'ui', 'dist'), { recursive: true });
	verifierSansLien(ressources);
}
