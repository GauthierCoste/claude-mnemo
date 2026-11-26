/**
 * Le code de Mnemo (paquets voisins de ce dépôt) emporté par l'app, dans un dossier de ressources qui reproduit la
 * disposition de ses `packages/` :
 *
 * - `mnemo/` : `packages/mnemo` et ses dépendances de production (`pnpm deploy --prod`), dont `node-pty` (précompilé N-API
 *   pour `darwin-<arch>`, seul gardé) ;
 * - `commun/`, `contrat/` : `@mnemo/commun` et `@mnemo/contrat` (leur `src/` en TypeScript) ;
 * - `ui/dist` : l'interface construite, là où `adaptateurs/http/statique.ts` la cherche (`../../../../ui/dist` depuis le
 *   fichier), sans `MNEMO_UI_DIST`.
 *
 * Pourquoi `commun/` et `contrat/` à côté, et pas dans `node_modules` : Node n'exécute pas le TypeScript situé sous
 * `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), or ces deux paquets exportent `./src/index.ts`. `pnpm deploy`
 * les copie dans `node_modules/.pnpm/` : ces copies sont retirées, et `node_modules/@mnemo/<paquet>` devient un lien relatif
 * vers `../../../<paquet>`, comme le lien du dépôt vers `packages/<paquet>`. Node suit les liens (chemin réel hors de
 * `node_modules`) : le TypeScript y est accepté. Les liens sont relatifs et restent dans le paquet (la signature les garde).
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ErreurConstruction } from './erreur.ts';

/** Paquets du dépôt emportés à côté de `mnemo/` (leur nom de dossier sous `packages/`). */
const PAQUETS_DU_DEPOT: Readonly<Record<string, string>> = { '@mnemo/commun': 'commun', '@mnemo/contrat': 'contrat' };

/** Fichiers de `packages/mnemo` inutiles à l'exécution (tests, configuration des outils, traces de `pnpm deploy`). */
const RETIRES_MNEMO = ['tests', 'vitest.config.ts', 'tsconfig.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.gitattributes'];
/** Métadonnées de pnpm sous `node_modules` (elles nomment le dépôt de la machine qui construit). */
const RETIRES_MODULES = ['.bin', '.modules.yaml', '.pnpm-workspace-state-v1.json', join('.pnpm', 'lock.yaml')];

const lireJson = (chemin: string): Record<string, unknown> => JSON.parse(readFileSync(chemin, 'utf8')) as Record<string, unknown>;

/** `pnpm` : celui qui lance la construction (`npm_execpath`), sinon celui du `PATH`. */
function pnpm(args: string[], cwd: string): void {
	const execpath = process.env['npm_execpath'];
	const [commande, debut] = execpath !== undefined && /pnpm[^/\\]*\.c?js$/u.test(execpath) ? [process.execPath, [execpath]] : ['pnpm', []];
	try {
		execFileSync(commande, [...debut, ...args], { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
	} catch (e) {
		const sortie = (e as { stderr?: Buffer }).stderr?.toString('utf8').trim();
		throw new ErreurConstruction(`pnpm ${args.join(' ')} a échoué${sortie ? ` : ${sortie}` : '.'}`);
	}
}

/**
 * Dépendances d'un `package.json` vers les paquets du dépôt (`workspace:` dans le dépôt ; `pnpm deploy` les réécrit en
 * `<nom>@file://<chemin absolu de la machine>`), réécrites en `file:../<dossier>` (le `package.json` est récrit). Toute autre
 * dépendance locale (`workspace:`, `file:`, `link:`) arrête la construction.
 */
function dependancesDuDepot(paquetJson: string): string[] {
	const paquet = lireJson(paquetJson);
	const deps = (paquet['dependencies'] ?? {}) as Record<string, string>;
	const locales = Object.keys(deps).filter((nom) => /(^|@)(workspace|file|link):/u.test(deps[nom]!));
	for (const nom of locales) if (PAQUETS_DU_DEPOT[nom] === undefined) throw new ErreurConstruction(`Dépendance locale inattendue : ${nom} (${paquetJson}).`);
	const duDepot = Object.keys(deps).filter((nom) => PAQUETS_DU_DEPOT[nom] !== undefined);
	for (const nom of duDepot) deps[nom] = `file:../${PAQUETS_DU_DEPOT[nom]!}`;
	writeFileSync(paquetJson, `${JSON.stringify(paquet, null, 2)}\n`);
	return duDepot;
}

/** Remplace `<dossier>/node_modules/<nom>` par un lien relatif vers le paquet du dépôt copié dans `ressources/`. */
function lierPaquetDuDepot(dossier: string, nom: string, ressources: string): void {
	const cible = PAQUETS_DU_DEPOT[nom]!;
	const lien = join(dossier, 'node_modules', ...nom.split('/'));
	rmSync(lien, { recursive: true, force: true });
	mkdirSync(dirname(lien), { recursive: true });
	symlinkSync(relative(dirname(lien), join(ressources, cible)), lien);
}

/** Garde seulement les précompilés de `darwin-<arch>` de node-pty (et rend `spawn-helper` exécutable : le paquet est signé). */
function elaguerNodePty(mnemo: string, arch: 'arm64' | 'x64'): void {
	const lien = join(mnemo, 'node_modules', 'node-pty');
	if (!existsSync(lien)) throw new ErreurConstruction('node-pty absent du déploiement de Mnemo.');
	const racine = resolve(dirname(lien), readlinkSync(lien));
	const gardes = `darwin-${arch}`;
	for (const dossier of readdirSync(join(racine, 'prebuilds'))) if (dossier !== gardes) rmSync(join(racine, 'prebuilds', dossier), { recursive: true });
	for (const dossier of ['deps', 'third_party', 'src', 'scripts']) rmSync(join(racine, dossier), { recursive: true, force: true });
	const assistant = join(racine, 'prebuilds', gardes, 'spawn-helper');
	if (!existsSync(join(racine, 'prebuilds', gardes, 'pty.node')) || !existsSync(assistant)) throw new ErreurConstruction(`Précompilé de node-pty absent pour ${gardes}.`);
	chmodSync(assistant, 0o755);
}

/** Tous les liens sous `dossier` : relatifs, résolus dans `ressources`, et vers un fichier existant. */
function verifierLiens(dossier: string, ressources: string): void {
	for (const entree of readdirSync(dossier, { recursive: true, withFileTypes: false }) as string[]) {
		const chemin = join(dossier, entree);
		if (!lstatSync(chemin).isSymbolicLink()) continue;
		const cible = readlinkSync(chemin);
		const resolue = resolve(dirname(chemin), cible);
		if (isAbsolute(cible) || !(resolue + sep).startsWith(ressources + sep) || !existsSync(resolue)) throw new ErreurConstruction(`Lien refusé dans le paquet : ${chemin} → ${cible}.`);
	}
}

/**
 * Remplit `ressources/` (qui ne doit pas encore contenir `mnemo/`) : voir l'en-tête. `espace` : la racine de l'espace pnpm
 * qui contient les paquets de Mnemo (ce dépôt) ; `paquets` : le dossier `packages/` du dépôt ;
 * `arch` : celle du Node emporté.
 */
export function deployerMnemo(espace: string, paquets: string, ressources: string, arch: 'arm64' | 'x64'): void {
	const ui = join(paquets, 'ui', 'dist');
	if (!existsSync(join(ui, 'index.html'))) throw new ErreurConstruction(`Interface non construite : ${ui} (pnpm --filter @mnemo/ui construire).`);
	mkdirSync(ressources, { recursive: true });
	const mnemo = join(ressources, 'mnemo');
	pnpm(['deploy', '--prod', '--filter', 'mnemo', mnemo], espace);
	for (const f of RETIRES_MNEMO) rmSync(join(mnemo, f), { recursive: true, force: true });
	for (const f of RETIRES_MODULES) rmSync(join(mnemo, 'node_modules', f), { recursive: true, force: true });

	// paquets du dépôt : copiés à côté (package.json et src/), puis leurs copies sous .pnpm retirées et remplacées par des liens
	for (const [nom, dossier] of Object.entries(PAQUETS_DU_DEPOT)) {
		const source = join(paquets, dossier);
		const paquet = lireJson(join(source, 'package.json'));
		delete paquet['scripts'];
		delete paquet['devDependencies'];
		mkdirSync(join(ressources, dossier));
		writeFileSync(join(ressources, dossier, 'package.json'), `${JSON.stringify(paquet, null, 2)}\n`);
		cpSync(join(source, 'src'), join(ressources, dossier, 'src'), { recursive: true });
		for (const copie of readdirSync(join(mnemo, 'node_modules', '.pnpm'))) {
			if (copie.startsWith(`${nom.replace('/', '+')}@`)) rmSync(join(mnemo, 'node_modules', '.pnpm', copie), { recursive: true });
		}
	}
	for (const nom of dependancesDuDepot(join(mnemo, 'package.json'))) lierPaquetDuDepot(mnemo, nom, ressources);
	for (const dossier of Object.values(PAQUETS_DU_DEPOT)) {
		for (const nom of dependancesDuDepot(join(ressources, dossier, 'package.json'))) lierPaquetDuDepot(join(ressources, dossier), nom, ressources);
	}

	elaguerNodePty(mnemo, arch);
	cpSync(ui, join(ressources, 'ui', 'dist'), { recursive: true });
	verifierLiens(ressources, ressources);
}
