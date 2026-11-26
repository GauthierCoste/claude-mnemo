/**
 * Donne aux étapes suivantes du job les chemins de l'essai (`chemins.ts`) en variables `MNEMO_…` (fichier `GITHUB_ENV`) et
 * crée le dossier des captures.
 *
 * Usage : node packages/app/outils/ci/env-ci.ts
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cheminsEssai } from './chemins.ts';
import { echouer, etape, executer } from './commun.ts';

const DEPOT = join(import.meta.dirname, '..', '..', '..', '..');

await executer(async () => {
	const fichier = process.env['GITHUB_ENV'];
	if (fichier === undefined) echouer('GITHUB_ENV absent : à lancer dans un job de GitHub Actions.');
	const version = String((JSON.parse(readFileSync(join(DEPOT, 'packages', 'app', 'package.json'), 'utf8')) as { version: unknown }).version);
	const c = cheminsEssai(DEPOT, version, process.env);
	mkdirSync(c.captures, { recursive: true });
	const variables: Record<string, string> = {
		MNEMO_VERSION: c.version,
		MNEMO_INSTALLEUR: c.installeur,
		MNEMO_INSTALLE: c.installe,
		MNEMO_EXE: c.exe,
		MNEMO_NODE: c.node,
		MNEMO_MAIN: c.main,
		MNEMO_ESSAI: c.essai,
		MNEMO_CAPTURES: c.captures,
	};
	for (const [cle, valeur] of Object.entries(variables)) {
		appendFileSync(fichier, `${cle}=${valeur}\n`);
		etape(`${cle}=${valeur}`);
	}
});
