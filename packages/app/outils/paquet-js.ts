/**
 * Copie d'un paquet TypeScript du dépôt (`@mnemo/commun`, `@mnemo/contrat`) traduite en JavaScript, pour la mettre sous
 * `node_modules` dans le paquet de l'app : Node refuse d'exécuter le TypeScript situé sous `node_modules`
 * (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), or ces paquets exportent `./src/index.ts`. Chaque fichier de `src/` est
 * traduit seul par TypeScript (`transpileModule` : types effacés, imports relatifs `.ts` récrits en `.js`, rien d'autre ;
 * la syntaxe du dépôt est effaçable) ; le `package.json` est recopié, ses exports pointant vers les `.js`, sans scripts ni
 * dépendances de développement.
 *
 * Pourquoi traduire plutôt que lier (`node_modules/@mnemo/<paquet>` lien vers une copie hors de `node_modules`, la
 * disposition d'avant) : l'installeur Windows ne garde pas les liens symboliques ; et un crochet de résolution
 * (`module.registerHooks`) posé par `main.ts` ne vaut pas pour les fils d'exécution (`worker_threads`) du service. Ainsi la
 * résolution reste celle de Node, la même sous macOS et Windows, sans lien.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { ErreurConstruction } from './erreur.ts';

const OPTIONS: ts.CompilerOptions = {
	module: ts.ModuleKind.ESNext,
	target: ts.ScriptTarget.ES2024,
	verbatimModuleSyntax: true,
	rewriteRelativeImportExtensions: true,
};

/** Spécificateur relatif encore en `.ts` dans du JavaScript traduit (un import que la réécriture aurait manqué). */
const IMPORT_TS_RESTANT = /(?:from\s+|import\s*\(\s*|import\s+)['"]\.{1,2}\/[^'"]*\.ts['"]/u;

/** Un fichier TypeScript traduit en JavaScript ; `nom` sert aux messages. */
export function traduireFichier(source: string, nom: string): string {
	const sortie = ts.transpileModule(source, { compilerOptions: OPTIONS, fileName: nom, reportDiagnostics: true });
	const erreurs = (sortie.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
	if (erreurs.length > 0) throw new ErreurConstruction(`Traduction de ${nom} impossible : ${ts.flattenDiagnosticMessageText(erreurs[0]!.messageText, ' ')}`);
	if (IMPORT_TS_RESTANT.test(sortie.outputText)) throw new ErreurConstruction(`Traduction de ${nom} : un import relatif en .ts reste.`);
	return sortie.outputText;
}

/** Exports d'un `package.json` dont les cibles `.ts` deviennent `.js` (chaîne, ou objet de conditions ou de sous-chemins). */
export function exportsEnJs(exports: unknown): unknown {
	if (typeof exports === 'string') return exports.replace(/\.ts$/u, '.js');
	if (exports !== null && typeof exports === 'object') return Object.fromEntries(Object.entries(exports).map(([cle, valeur]) => [cle, exportsEnJs(valeur)]));
	return exports;
}

/**
 * Écrit dans `destination` (créé) le paquet `source` traduit : `src/**.ts` en `.js` (les `.d.ts` et autres fichiers sont
 * refusés : il n'y en a pas), et son `package.json` avec `dependances` à la place de ses dépendances.
 */
export function ecrirePaquetJs(source: string, destination: string, dependances: Readonly<Record<string, string>>): void {
	const paquet = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')) as Record<string, unknown>;
	delete paquet['scripts'];
	delete paquet['devDependencies'];
	paquet['exports'] = exportsEnJs(paquet['exports']);
	if (Object.keys(dependances).length > 0) paquet['dependencies'] = { ...dependances };
	else delete paquet['dependencies'];
	mkdirSync(destination, { recursive: true });
	writeFileSync(join(destination, 'package.json'), `${JSON.stringify(paquet, null, 2)}\n`);
	for (const entree of readdirSync(join(source, 'src'), { recursive: true, withFileTypes: true })) {
		if (entree.isDirectory()) continue;
		const chemin = join(entree.parentPath, entree.name);
		const relatif = chemin.slice(join(source, 'src').length + 1);
		if (!entree.isFile() || !entree.name.endsWith('.ts') || entree.name.endsWith('.d.ts')) throw new ErreurConstruction(`Fichier inattendu dans ${join(source, 'src')} : ${relatif}.`);
		const cible = join(destination, 'src', relatif.replace(/\.ts$/u, '.js'));
		mkdirSync(dirname(cible), { recursive: true });
		writeFileSync(cible, traduireFichier(readFileSync(chemin, 'utf8'), chemin));
	}
}
