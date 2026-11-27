/**
 * Publie une version de Mnemo : `pnpm publier patch|feature|version [--essai]`.
 *
 * Avant d'écrire quoi que ce soit, vérifie : branche `main`, copie de travail propre (seules les notes
 * `docs/releases/next.md` peuvent y être modifiées), `main` à jour avec `origin/main`, même version dans les cinq
 * `packages/*\/package.json`, étiquette libre, notes présentes. Puis lance `pnpm verifier` et `pnpm test`, monte la version
 * (paquets et ligne « Version » du README), renomme les notes en `docs/releases/<version>.md`, commite
 * « chore: version x.y.z », pose l'étiquette `x.y.z`, lance `pnpm verifier-publication` sur ce commit et pousse `main` et
 * l'étiquette ensemble (`--atomic`). La poussée de l'étiquette lance `.github/workflows/release.yml`, qui construit le
 * `.dmg` et l'installeur Windows et crée la release.
 *
 * Les tests tournent avec `CI=1`, comme dans la CI : les sondes qui peuvent abattre le processus de test y sont sautées.
 * `--essai` : les vérifications seulement, sans tests, sans rien écrire ni pousser.
 * Une erreur arrête tout ; après le commit, rien n'est défait automatiquement : le message dit quoi faire.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { avecVersionPaquet, avecVersionReadme, estNiveau, NIVEAUX, problemeDesNotes, versionSuivante } from './publier/version.ts';

const RACINE = join(import.meta.dirname, '..');
const PAQUETS = ['app', 'commun', 'contrat', 'mnemo', 'ui'].map((p) => join('packages', p, 'package.json'));
const NOTES = join('docs', 'releases', 'next.md');
const DEPOT = 'GauthierCoste/mnemo';

function sortir(message: string): never {
	console.error(`publier : ${message}`);
	process.exit(1);
}

function git(...args: string[]): string {
	return execFileSync('git', args, { cwd: RACINE, encoding: 'utf8' }).trim();
}

function lancer(commande: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
	console.log(`\n$ ${commande} ${args.join(' ')}`);
	try {
		execFileSync(commande, args, { cwd: RACINE, stdio: 'inherit', env });
	} catch {
		sortir(`« ${commande} ${args.join(' ')} » a échoué.`);
	}
}

const lire = (chemin: string): string => readFileSync(join(RACINE, chemin), 'utf8');

function verifierDepart(): { actuelle: string; nouvelle: string } {
	const niveau = process.argv[2];
	if (!estNiveau(niveau)) sortir(`niveau attendu : ${NIVEAUX.join(' | ')}. Usage : pnpm publier <niveau> [--essai]`);

	if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') sortir('se placer sur main.');
	const sales = git('status', '--porcelain', '--untracked-files=all')
		.split('\n')
		.filter((l) => l.length > 0 && l.slice(3) !== NOTES.replaceAll('\\', '/'));
	if (sales.length > 0) sortir(`copie de travail non propre :\n${sales.join('\n')}`);

	git('fetch', '--quiet', '--tags', 'origin');
	try {
		git('merge-base', '--is-ancestor', 'origin/main', 'HEAD');
	} catch {
		sortir('main est en retard sur origin/main : git pull --ff-only.');
	}

	const versions = new Set(PAQUETS.map((p) => (JSON.parse(lire(p)) as { version: string }).version));
	if (versions.size !== 1) sortir(`versions différentes dans les paquets : ${[...versions].join(', ')}.`);
	const actuelle = [...versions][0] as string;
	const nouvelle = versionSuivante(actuelle, niveau);
	if (git('tag', '--list', nouvelle) !== '') sortir(`l'étiquette ${nouvelle} existe déjà.`);

	if (!existsSync(join(RACINE, NOTES))) sortir(`notes absentes : écrire ${NOTES} (en anglais, ce qui change pour l'utilisateur).`);
	const probleme = problemeDesNotes(lire(NOTES));
	if (probleme) sortir(`${NOTES} : ${probleme}`);
	return { actuelle, nouvelle };
}

function monter(actuelle: string, nouvelle: string): void {
	for (const p of PAQUETS) writeFileSync(join(RACINE, p), avecVersionPaquet(lire(p), actuelle, nouvelle));
	writeFileSync(join(RACINE, 'README.md'), avecVersionReadme(lire('README.md'), actuelle, nouvelle));
	const notes = join('docs', 'releases', `${nouvelle}.md`);
	renameSync(join(RACINE, NOTES), join(RACINE, notes));
	git('add', '--all', '--', ...PAQUETS, 'README.md', join('docs', 'releases'));
	git('commit', '--quiet', '-m', `chore: version ${nouvelle}`);
	git('tag', nouvelle);
}

function principal(): void {
	const { actuelle, nouvelle } = verifierDepart();
	console.log(`Version ${actuelle} → ${nouvelle}`);
	if (process.argv.includes('--essai')) {
		console.log('Essai : vérifications passées, rien n’est écrit.');
		return;
	}
	lancer('pnpm', ['verifier']);
	// Tests dans les conditions de la CI (`CI=1`) : les sondes de mémoire d'extraction-isolee, que V8 peut faire tomber avec
	// tout le processus, y sont sautées, comme dans release.yml (voir le risque dans decisions.md).
	lancer('pnpm', ['test'], { ...process.env, CI: '1' });
	monter(actuelle, nouvelle);
	try {
		execFileSync('pnpm', ['verifier-publication'], { cwd: RACINE, stdio: 'inherit' });
	} catch {
		sortir(
			`vérification de publication en échec sur le commit ${nouvelle} (rien n'est poussé). Corriger, puis :\n` +
				`  git tag -d ${nouvelle} && git reset --soft HEAD~1   # défait le commit de version, garde les changements`,
		);
	}
	lancer('git', ['push', '--atomic', 'origin', 'main', `refs/tags/${nouvelle}`]);
	console.log(`\nPoussé : ${nouvelle}. Release en construction : https://github.com/${DEPOT}/actions/workflows/release.yml`);
	console.log(`Elle paraîtra sur https://github.com/${DEPOT}/releases/tag/${nouvelle}`);
}

principal();
