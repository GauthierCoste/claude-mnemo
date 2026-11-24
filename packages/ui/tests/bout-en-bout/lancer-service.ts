/**
 * Le vrai service Mnemo pour les tests de bout en bout de l'interface : `mnemo init` puis `mnemo <dossier>` en processus
 * enfant (comme un utilisateur), avec le faux `claude` des tests (jamais le vrai), un `HOME` temporaire, aucun modèle
 * (dossier vide existant), aucun navigateur, aucune déclaration MCP, et l'interface construite par le test (`MNEMO_UI_DIST`).
 */
import { execFile, execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';

const MAIN = resolve(import.meta.dirname, '../../../mnemo/src/adaptateurs/cli/main.ts');
const FAUX_CLAUDE = resolve(import.meta.dirname, '../../../mnemo/tests/aides/faux-claude.mjs');
const RACINE_UI = resolve(import.meta.dirname, '../..');

export type ServiceLance = { port: number; jeton: string; arreter(signal?: NodeJS.Signals): Promise<void> };

/** Environnement d'un processus `mnemo` du test ; `port` : 0 (un port libre) ou celui d'un service précédent (redémarrage). */
function environnement(home: string, dist: string, port: number): NodeJS.ProcessEnv {
	const modeles = join(home, 'modeles-vide');
	mkdirSync(modeles, { recursive: true });
	return {
		...process.env,
		HOME: home,
		MNEMO_CLAUDE: FAUX_CLAUDE,
		MNEMO_SANS_MCP: '1',
		MNEMO_MODELES: modeles,
		MNEMO_SANS_NAVIGATEUR: '1',
		MNEMO_UI_DIST: dist,
		MNEMO_PORT: String(port),
	};
}

const homeTemporaire = () => realpathSync(mkdtempSync(join(tmpdir(), 'mnemo-ui-bout-home-')));

/** `mnemo <args>` dans `dossier` (une commande courte : `init`, `jeton --renouveler`) ; rend sa sortie, lève s'il échoue. */
export function commandeMnemo(o: { dossier: string; dist: string; args: string[] }): Promise<string> {
	const home = homeTemporaire();
	return new Promise((resoudre, rejeter) => {
		execFile(process.execPath, [MAIN, ...o.args], { cwd: o.dossier, env: environnement(home, o.dist, 0), timeout: 60_000 }, (erreur, sortie, erreurs) => {
			rmSync(home, { recursive: true, force: true });
			if (erreur) rejeter(new Error(`mnemo ${o.args.join(' ')} : ${erreur.message}\n${sortie}${erreurs}`));
			else resoudre(sortie);
		});
	});
}

/** Processus dont la ligne de commande contient `texte` (POSIX, d'après `ps`) : les restes d'un service tué. */
function processusAvec(texte: string): number[] {
	if (process.platform === 'win32') return [];
	const sortie = execFileSync('ps', ['-A', '-ww', '-o', 'pid=,command='], { encoding: 'utf8' });
	return sortie
		.split('\n')
		.map((l) => /^\s*(\d+)\s+(.*)$/u.exec(l))
		.filter((m): m is RegExpExecArray => m !== null && m[2]!.includes(texte) && Number(m[1]) !== process.pid)
		.map((m) => Number(m[1]));
}

/** Tue (SIGKILL) tout processus resté vivant dont la ligne de commande nomme `dossier` (service, faux `claude`, hooks). */
export function tuerLesRestes(dossier: string): void {
	for (const pid of processusAvec(dossier)) {
		try {
			process.kill(pid, 'SIGKILL');
		} catch {
			// déjà mort
		}
	}
}

/**
 * Lance le service du dossier Mnemo `dossier` (créé par `mnemo init --oui` s'il n'a pas de mémoire) et attend son
 * `.mnemo/service.json`. `port` : celui d'un service précédent, pour qu'un client déjà ouvert le retrouve (sinon un port
 * libre). `arreter` envoie le signal (SIGTERM par défaut), attend la fin (SIGKILL au-delà de 30 s) et tue les restes.
 */
export async function lancerService(o: { dossier: string; dist: string; port?: number }): Promise<ServiceLance> {
	if (!existsSync(join(o.dossier, '_mnemo', 'SCHEMA.md'))) await commandeMnemo({ dossier: o.dossier, dist: o.dist, args: ['init', '--oui'] });
	const home = homeTemporaire();
	const fichier = join(o.dossier, '.mnemo', 'service.json');
	// celui d'un service tué sans arrêt propre ne doit pas être pris pour le nouveau
	rmSync(fichier, { force: true });
	const enfant = spawn(process.execPath, [MAIN, o.dossier], { cwd: home, env: environnement(home, o.dist, o.port ?? 0), stdio: ['ignore', 'pipe', 'pipe'] });
	let sortie = '';
	enfant.stdout.on('data', (m: Buffer) => {
		sortie += m.toString('utf8');
	});
	enfant.stderr.on('data', (m: Buffer) => {
		sortie += m.toString('utf8');
	});
	const fin = new Promise<void>((r) => enfant.once('exit', () => r()));
	const vivant = () => enfant.exitCode === null && enfant.signalCode === null;

	const arreter = async (signal: NodeJS.Signals = 'SIGTERM') => {
		if (vivant()) {
			enfant.kill(signal);
			const delai = setTimeout(() => enfant.kill('SIGKILL'), 30_000);
			await fin;
			clearTimeout(delai);
		}
		tuerLesRestes(o.dossier);
		try {
			rmSync(home, { recursive: true, force: true, maxRetries: 3 });
		} catch (e) {
			// Sous Windows, SIGTERM tue le service net (TerminateProcess) sans ses enfants, et `tuerLesRestes` n'y voit rien :
			// un reste qui a hérité du dossier courant (home) empêche de le supprimer. Le dossier, temporaire, est laissé au
			// système ; ailleurs, l'erreur reste une erreur.
			if (process.platform !== 'win32' || !['EPERM', 'EBUSY'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e;
		}
	};

	const limite = Date.now() + 30_000;
	for (;;) {
		try {
			const s = JSON.parse(readFileSync(fichier, 'utf8')) as { pid: number; port: number; jeton: string };
			if (s.pid === enfant.pid) return { port: s.port, jeton: s.jeton, arreter };
		} catch {
			// pas encore écrit
		}
		if (!vivant() || Date.now() > limite) {
			await arreter('SIGKILL');
			throw new Error(`Le service ne s'est pas lancé :\n${sortie}`);
		}
		await new Promise((r) => setTimeout(r, 50));
	}
}

/** Construit l'interface comme `pnpm construire`, dans un dossier temporaire (rendu ; à effacer par l'appelant). */
export async function construireInterface(): Promise<string> {
	const sortie = realpathSync(mkdtempSync(join(tmpdir(), 'mnemo-ui-bout-dist-')));
	// Vitest pose NODE_ENV=test, que Vite garderait (import.meta.env.DEV vrai) : on construit en production.
	const avant = process.env['NODE_ENV'];
	process.env['NODE_ENV'] = 'production';
	try {
		await build({ root: RACINE_UI, configFile: join(RACINE_UI, 'vite.config.ts'), mode: 'production', logLevel: 'silent', build: { outDir: sortie, emptyOutDir: true } });
	} finally {
		if (avant === undefined) delete process.env['NODE_ENV'];
		else process.env['NODE_ENV'] = avant;
	}
	return sortie;
}
