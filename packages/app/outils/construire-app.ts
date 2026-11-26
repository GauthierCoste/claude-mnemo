/**
 * Assemble `dist/Mnemo.app` (macOS) avec `@electron/packager`, à partir du processus principal construit par Vite
 * (`dist/main.js`) : architecture de la machine, identifiant `local.mnemo.app`, icône `.icns` faite des PNG de l'interface
 * construite (`packages/ui/dist/icones/`), signature ad hoc (identité `-` : sans elle, le paquet modifié ne se lance pas sur
 * Apple silicon ; ou Developer ID, voir plus bas). Lancé par `pnpm construire-app [--dmg]` à la racine, après la construction de l'interface et de ce paquet.
 *
 * Le paquet est autonome : il emporte le Node officiel (`Contents/Resources/node/bin/node`, voir `node-officiel.ts`) et le
 * code de Mnemo avec l'interface construite (`Contents/Resources/{mnemo,commun,contrat,ui}`, voir `mnemo-deploye.ts`), que
 * l'app lance (`src/infra/emplacement.ts`). La signature ad hoc du packager signe aussi ces binaires (`node`, `pty.node`,
 * `spawn-helper`). Architecture : celle de la machine (pas de paquet universel).
 *
 * `--dmg` : produit aussi `dist/Mnemo-<version>-<arch>.dmg` (voir `dmg.ts`). Signature : ad hoc, ou Developer ID et
 * notarisation si l'environnement les donne (voir `signature.ts`).
 *
 * Outil de construction : il peut importer le code du service (`icns.ts`, du paquet `mnemo`), que l'app elle-même
 * (`src/`) n'importe jamais.
 */
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { packager } from '@electron/packager';
import { icnsDepuisPng, type TypeIcns } from '../../mnemo/src/infra/icns.ts';
import { ErreurConstruction } from './erreur.ts';
import { creerDmg, nomDmg } from './dmg.ts';
import { deployerMnemo } from './mnemo-deploye.ts';
import { archiveNodeVerifiee, extraireNode, lireVersionNode } from './node-officiel.ts';
import { decrireSignature, DROITS_NODE, estNodeEmporte, type Signature, signatureDepuisEnv } from './signature.ts';

/** Identifiant du paquet : `pnpm installer-dev` reconnaît ainsi le nôtre (et remplace le lanceur `local.mnemo.lanceur`). */
export const IDENTIFIANT_APP = 'local.mnemo.app';
export const NOM_APP = 'Mnemo';

const APP = join(import.meta.dirname, '..');
const DIST = join(APP, 'dist');
/** Racine du dépôt (l’espace pnpm). */
const RACINE = join(APP, '..', '..');
const ICONES_UI = join(RACINE, 'packages', 'ui', 'dist', 'icones');
const PAQUET = join(DIST, `${NOM_APP}.app`);
/** Archives de Node téléchargées (ignoré par git). */
const CACHE = join(APP, '.cache');
/** Ressources copiées par le crochet du packager (les liens relatifs de `node_modules` gardés tels quels). */
const RESSOURCES_AVEC_LIENS = ['mnemo', 'commun', 'contrat', 'ui'];

const lireJson = (chemin: string): Record<string, unknown> => JSON.parse(readFileSync(chemin, 'utf8')) as Record<string, unknown>;

function sortir(message: string): never {
	throw new ErreurConstruction(message);
}

/** `.icns` des PNG 256, 512 et 1024 de l'interface construite. */
function icns(): Buffer {
	const entrees: { type: TypeIcns; png: Buffer }[] = [];
	for (const [type, taille] of [['ic08', 256], ['ic09', 512], ['ic10', 1024]] as const) {
		try {
			entrees.push({ type, png: readFileSync(join(ICONES_UI, `icone-${taille}.png`)) });
		} catch {
			sortir(`Icône absente : ${join(ICONES_UI, `icone-${taille}.png`)} (construisez l’interface : pnpm --filter @mnemo/ui construire).`);
		}
	}
	return icnsDepuisPng(entrees);
}

/** Options de signature de `@electron/packager` (`@electron/osx-sign`, `@electron/notarize`). */
function optionsSignature(signature: Signature): Pick<Parameters<typeof packager>[0], 'osxSign' | 'osxNotarize'> {
	if (signature.mode === 'adhoc') {
		// pas de compte Apple Developer : identité « - » ; un échec arrête la construction
		return { osxSign: { identity: '-', identityValidation: false, continueOnError: false, preAutoEntitlements: false, optionsForFile: () => ({ hardenedRuntime: false }) } };
	}
	return {
		osxSign: {
			identity: signature.identite,
			continueOnError: false,
			preAutoEntitlements: false,
			// les autres fichiers : droits par défaut d'Electron (runtime renforcé) ; le Node emporté : ceux de V8 hors d'Electron
			optionsForFile: (chemin) => (estNodeEmporte(chemin) ? { hardenedRuntime: true, entitlements: DROITS_NODE } : {}),
		},
		...(signature.notarisation === null ? {} : { osxNotarize: signature.notarisation }),
	};
}

async function construire(args: readonly string[]): Promise<void> {
	if (process.platform !== 'darwin') sortir('Mnemo.app se construit sur macOS.');
	const inconnue = args.find((a) => a !== '--dmg');
	if (inconnue !== undefined) sortir(`Option inconnue : « ${inconnue} ». Usage : pnpm construire-app [--dmg]`);
	const signature = signatureDepuisEnv(process.env);
	try {
		readFileSync(join(DIST, 'main.js'));
	} catch {
		sortir(`Processus principal absent : ${join(DIST, 'main.js')} (pnpm --filter @mnemo/app construire).`);
	}
	const version = String(lireJson(join(APP, 'package.json'))['version']);
	const electron = String(lireJson(join(APP, 'node_modules', 'electron', 'package.json'))['version']);
	const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
	const versionNode = lireVersionNode(join(import.meta.dirname, 'version-node.txt'));

	// dans dist/ : même volume que la destination (renommage sans copie)
	const travail = mkdtempSync(join(DIST, '.construction-'));
	try {
		// Le dossier de l'app : la sortie de Vite (sans un paquet ni une image déjà assemblés) et un package.json minimal, sans dépendance
		// (main.js les contient déjà).
		const source = join(travail, 'app');
		mkdirSync(source);
		for (const entree of readdirSync(DIST)) {
			if (entree.endsWith('.app') || entree.endsWith('.dmg') || entree.startsWith('.')) continue;
			cpSync(join(DIST, entree), join(source, entree), { recursive: true });
		}
		writeFileSync(join(source, 'package.json'), `${JSON.stringify({ name: 'mnemo-app', productName: NOM_APP, version, private: true, type: 'module', main: 'main.js' }, null, 2)}\n`);
		const icone = join(travail, `${NOM_APP}.icns`);
		writeFileSync(icone, icns());

		// Node officiel et code de Mnemo, ajoutés aux ressources du paquet avant sa signature
		const ressources = join(travail, 'ressources');
		const archive = await archiveNodeVerifiee(versionNode, arch, CACHE, readFileSync(join(import.meta.dirname, 'sommes-node.txt'), 'utf8'));
		await extraireNode(archive, versionNode, arch, join(ressources, 'node'));
		deployerMnemo(RACINE, join(RACINE, 'packages'), ressources, arch);

		const [chemin] = await packager({
			dir: source,
			out: join(travail, 'sortie'),
			name: NOM_APP,
			executableName: NOM_APP,
			appBundleId: IDENTIFIANT_APP,
			appVersion: version,
			buildVersion: version,
			appCategoryType: 'public.app-category.productivity',
			platform: 'darwin',
			arch,
			electronVersion: electron,
			icon: icone,
			// `extraResource` copie sans garder les liens relatifs tels quels : seul Node y passe, le reste par le crochet
			extraResource: [join(ressources, 'node')],
			afterCopyExtraResources: [
				({ buildPath }) => {
					const destination = join(buildPath, `${NOM_APP}.app`, 'Contents', 'Resources');
					for (const nom of RESSOURCES_AVEC_LIENS) cpSync(join(ressources, nom), join(destination, nom), { recursive: true, verbatimSymlinks: true });
				},
			],
			asar: true,
			prune: false,
			overwrite: true,
			quiet: true,
			...optionsSignature(signature),
		});
		if (chemin === undefined) sortir('@electron/packager n’a rien produit.');
		rmSync(PAQUET, { recursive: true, force: true });
		renameSync(join(chemin, `${NOM_APP}.app`), PAQUET);
	} finally {
		rmSync(travail, { recursive: true, force: true });
	}
	console.log(`Construit : ${PAQUET}`);
	console.log(decrireSignature(signature));
	if (args.includes('--dmg')) {
		const dmg = join(DIST, nomDmg(NOM_APP, version, arch));
		creerDmg(PAQUET, dmg, `${NOM_APP} ${version}`);
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
