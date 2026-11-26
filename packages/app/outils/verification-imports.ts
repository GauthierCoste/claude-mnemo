/**
 * Vérification du code de Mnemo emporté, à la construction : le Node emporté, lancé dans `mnemo/`, importe chaque module
 * que le code source importe par son nom (`@mnemo/commun`, `@mnemo/contrat`, sous-chemins compris, imports de types
 * exclus) et chaque dépendance de production qu'aucun de ces noms ne couvre (`node-pty`, chargé par un nom en variable).
 * Un échec arrête la construction : mieux qu'une app qui s'installe puis ne démarre pas son service (résolution sans lien,
 * précompilé de node-pty, élagage trop large).
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ErreurConstruction } from './erreur.ts';

/** Imports statiques (`import … from`, `export … from`, `import '…'`) et dynamiques à chaîne littérale. */
const IMPORTS = /^\s*(?:import|export)\s+(type\s+)?[^;'"]*?\bfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gmu;

const estNu = (specificateur: string): boolean => !specificateur.startsWith('.') && !specificateur.startsWith('/') && !specificateur.startsWith('node:');

/** Spécificateurs nus (ni relatifs, ni `node:`) importés par ces sources, hors imports de types ; triés, sans doublon. */
export function specificateursNus(sources: Iterable<string>): string[] {
	const trouves = new Set<string>();
	for (const texte of sources) {
		for (const m of texte.matchAll(IMPORTS)) {
			if (m[1] !== undefined) continue;
			const specificateur = (m[2] ?? m[3] ?? m[4])!;
			if (estNu(specificateur)) trouves.add(specificateur);
		}
	}
	return [...trouves].sort();
}

/** Les spécificateurs importés, et les dépendances qu'aucun ne couvre (ni lui-même, ni un de ses sous-chemins). */
export function modulesAVerifier(importes: readonly string[], dependances: readonly string[]): string[] {
	const couvertes = (nom: string): boolean => importes.some((s) => s === nom || s.startsWith(`${nom}/`));
	return [...new Set([...importes, ...dependances.filter((d) => !couvertes(d))])].sort();
}

/** Script ESM qui importe chaque module et sort en erreur (code 1) en les nommant tous si l'un échoue. */
export function scriptVerification(modules: readonly string[]): string {
	return `const echecs = [];
for (const nom of ${JSON.stringify(modules)}) {
	try {
		await import(nom);
	} catch (e) {
		echecs.push(\`\${nom} : \${e instanceof Error ? e.message : String(e)}\`);
	}
}
if (echecs.length > 0) {
	console.error(echecs.join('\\n'));
	process.exit(1);
}
`;
}

/** Vérifie le dossier `mnemo` emporté avec le Node emporté `node` (voir l'en-tête). */
export function verifierImports(node: string, mnemo: string): void {
	const sources: string[] = [];
	for (const f of readdirSync(join(mnemo, 'src'), { recursive: true }) as string[]) if (f.endsWith('.ts')) sources.push(readFileSync(join(mnemo, 'src', f), 'utf8'));
	const paquet = JSON.parse(readFileSync(join(mnemo, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
	const dependances = [...Object.keys(paquet['dependencies'] ?? {}), ...Object.keys(paquet['optionalDependencies'] ?? {})];
	const modules = modulesAVerifier(specificateursNus(sources), dependances);
	const script = join(mnemo, '.verification-imports.mjs');
	writeFileSync(script, scriptVerification(modules));
	try {
		execFileSync(node, [script], { cwd: mnemo, stdio: ['ignore', 'ignore', 'pipe'], timeout: 120_000 });
	} catch (e) {
		const sortie = (e as { stderr?: Buffer }).stderr?.toString('utf8').trim();
		throw new ErreurConstruction(`Le code de Mnemo emporté ne se charge pas avec le Node emporté${sortie ? ` :\n${sortie}` : ` (${e instanceof Error ? e.message : String(e)}).`}`);
	} finally {
		rmSync(script, { force: true });
	}
}
