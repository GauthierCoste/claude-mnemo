// Le PATH du terminal : le lanceur est remplacé (jamais le vrai shell de l'utilisateur) ; le vrai lanceur est essayé sur
// un faux shell (script Node écrit dans un dossier temporaire).
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pathParDefaut } from '../../src/infra/emplacement.ts';
import { environnementShell, lanceurShellReel, lirePathTerminal, type LanceurShell } from '../../src/infra/path-terminal.ts';

const dossiers: string[] = [];
afterEach(() => {
	for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true });
});
const temporaire = () => {
	const d = realpathSync(mkdtempSync(join(tmpdir(), 'mnemo-app-path-')));
	dossiers.push(d);
	return d;
};

const HOME = '/maison/exemple';
const BASE = { SHELL: '/bin/bash', PATH: '/usr/bin:/bin', HOME, SECRET: 'jamais transmis' };

/** Faux lanceur : rend la sortie d'un shell qui exécuterait vraiment la commande (le PATH donné entre les marqueurs). */
function lanceurQuiRepond(path: string, bruit = 'Bienvenue !\n'): { lanceur: LanceurShell; appels: { shell: string; args: string[]; env: NodeJS.ProcessEnv; delaiMs: number }[] } {
	const appels: { shell: string; args: string[]; env: NodeJS.ProcessEnv; delaiMs: number }[] = [];
	return {
		appels,
		lanceur: async (shell, args, { env, delaiMs }) => {
			appels.push({ shell, args, env, delaiMs });
			const [debut, fin] = [...args[1]!.matchAll(/'(__MNEMO_PATH_[A-Z]+_[0-9a-f]+__)'/gu)].map((r) => r[1]!);
			return `${bruit}${debut}${path}${fin}\nau revoir\n`;
		},
	};
}

describe('PATH du terminal', () => {
	it('lu dans le shell de connexion ($SHELL, -ilc, 10 s, environnement minimal)', async () => {
		const { lanceur, appels } = lanceurQuiRepond('/maison/exemple/.nvm/versions/node/v26/bin:/opt/homebrew/bin:/usr/bin:/bin');
		const journal: string[] = [];
		expect(await lirePathTerminal({ home: HOME, base: BASE, plateforme: 'darwin', lanceur, journal: (l) => void journal.push(l) })).toEqual({
			path: '/maison/exemple/.nvm/versions/node/v26/bin:/opt/homebrew/bin:/usr/bin:/bin',
			origine: 'shell',
		});
		expect(appels).toHaveLength(1);
		expect(appels[0]).toMatchObject({ shell: '/bin/bash', delaiMs: 10_000, env: { SHELL: '/bin/bash', PATH: '/usr/bin:/bin', HOME } });
		expect(appels[0]!.args[0]).toBe('-ilc');
		expect(appels[0]!.env).not.toHaveProperty('SECRET');
		expect(journal).toEqual([]);
	});

	it('sans $SHELL : /bin/zsh ; marqueurs différents à chaque lecture', async () => {
		const { lanceur, appels } = lanceurQuiRepond('/usr/bin');
		await lirePathTerminal({ home: HOME, base: { PATH: '/usr/bin' }, plateforme: 'darwin', lanceur });
		await lirePathTerminal({ home: HOME, base: { PATH: '/usr/bin' }, plateforme: 'darwin', lanceur });
		expect(appels.map((a) => a.shell)).toEqual(['/bin/zsh', '/bin/zsh']);
		expect(appels[0]!.args[1]).not.toBe(appels[1]!.args[1]);
	});

	it('repli sur le PATH par défaut, journalisé : échec, délai dépassé, sortie sans marqueurs ou sans chemin absolu, Windows', async () => {
		const defaut = pathParDefaut(HOME, BASE.PATH, 'darwin');
		const cas: [string, LanceurShell][] = [
			['échec', async () => Promise.reject(new Error('spawn /bin/bash ENOENT'))],
			['sans marqueurs', async () => 'zsh: command not found: printf'],
			['invalide', lanceurQuiRepond('relatif:bin').lanceur],
		];
		for (const [nom, lanceur] of cas) {
			const journal: string[] = [];
			const r = await lirePathTerminal({ home: HOME, base: BASE, plateforme: 'darwin', lanceur, journal: (l) => void journal.push(l) });
			expect(r, nom).toMatchObject({ path: defaut, origine: 'defaut' });
			expect(journal, nom).toHaveLength(1);
			expect(journal[0], nom).toMatch(/^PATH du terminal non lu \(\/bin\/bash : .*\) : PATH par défaut\.$/u);
		}
		let appele = false;
		const windows = await lirePathTerminal({ home: HOME, base: BASE, plateforme: 'win32', lanceur: async () => ((appele = true), '') });
		expect(windows).toMatchObject({ origine: 'defaut' });
		expect(appele).toBe(false);
		// sous Windows, la variable s'appelle `Path` : lue sans tenir compte de la casse, prise telle quelle
		expect(await lirePathTerminal({ home: HOME, base: { Path: 'C:\\Windows;C:\\Git\\cmd' }, plateforme: 'win32' })).toMatchObject({ path: 'C:\\Windows;C:\\Git\\cmd', origine: 'defaut' });
	});

	it('environnement minimal : quelques variables de l’app, rien d’autre', () => {
		expect(environnementShell({ HOME, USER: 'exemple', LANG: 'fr_FR.UTF-8', PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--x' })).toEqual({ HOME, USER: 'exemple', LANG: 'fr_FR.UTF-8', PATH: '/usr/bin' });
	});
});

// propre à macOS (aucun shell de connexion lu sous Windows) : faux shell à shebang rendu exécutable, groupe de processus tué
// par un pid négatif, rien de cela n'existe sous Windows
describe.skipIf(process.platform === 'win32')('vrai lanceur, sur un faux shell', () => {
	/** Faux shell : un script Node exécutable (`script`), à la place du shell de l'utilisateur. */
	function fauxShell(script: string): string {
		const d = temporaire();
		const chemin = join(d, 'faux-shell');
		writeFileSync(chemin, `#!${process.execPath}\n${script}\n`);
		chmodSync(chemin, 0o755);
		return chemin;
	}

	it('lance sans shell intermédiaire, entrée fermée, rend la sortie standard', async () => {
		const d = temporaire();
		const trace = join(d, 'trace.json');
		const shell = fauxShell(`
const fs = require('node:fs');
let entree = '';
process.stdin.on('data', (m) => (entree += m));
process.stdin.on('end', () => {
	fs.writeFileSync(${JSON.stringify(trace)}, JSON.stringify({ args: process.argv.slice(2), entree, env: Object.keys(process.env).sort() }));
	process.stdout.write('bruit\\n__MNEMO_PATH_DEBUT_aa__/usr/bin:/bin__MNEMO_PATH_FIN_aa__');
});`);
		const sortie = await lanceurShellReel(shell, ['-ilc', 'commande'], { env: { HOME: d, PATH: '/usr/bin:/bin' }, delaiMs: 10_000 });
		expect(sortie).toBe('bruit\n__MNEMO_PATH_DEBUT_aa__/usr/bin:/bin__MNEMO_PATH_FIN_aa__');
		const lu = JSON.parse(readFileSync(trace, 'utf8')) as { args: string[]; entree: string; env: string[] };
		expect(lu.args).toEqual(['-ilc', 'commande']);
		expect(lu.entree).toBe('');
		expect(lu.env).not.toContain('SECRET');
	});

	it('délai dépassé (shell qui ignore SIGTERM) : tué, rejet', async () => {
		const shell = fauxShell(`process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`);
		const debut = Date.now();
		await expect(lanceurShellReel(shell, ['-ilc', 'x'], { env: { PATH: '/usr/bin:/bin' }, delaiMs: 300 })).rejects.toThrow('pas de réponse');
		expect(Date.now() - debut).toBeLessThan(5000);
	});

	it('un descendant lancé en arrière-plan qui garde la sortie ouverte : conclu à la sortie du shell, sans attendre le délai', async () => {
		const d = temporaire();
		const pid = join(d, 'descendant.pid');
		const shell = fauxShell(`
const { spawn } = require('node:child_process');
const fils = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: ['ignore', 'inherit', 'inherit'], detached: true });
require('node:fs').writeFileSync(${JSON.stringify(pid)}, String(fils.pid));
fils.unref();
process.stdout.write('__MNEMO_PATH_DEBUT_aa__/usr/bin__MNEMO_PATH_FIN_aa__');`);
		const debut = Date.now();
		try {
			expect(await lanceurShellReel(shell, ['-ilc', 'x'], { env: { PATH: '/usr/bin:/bin' }, delaiMs: 5000 })).toBe('__MNEMO_PATH_DEBUT_aa__/usr/bin__MNEMO_PATH_FIN_aa__');
			expect(Date.now() - debut).toBeLessThan(3000);
		} finally {
			try {
				process.kill(Number(readFileSync(pid, 'utf8')), 'SIGKILL');
			} catch {
				// déjà parti
			}
		}
	});

	it('sortie énorme : arrêtée, rejet qui le dit', async () => {
		const shell = fauxShell(`const bloc = 'x'.repeat(65536); const ecrire = () => { while (process.stdout.write(bloc)); process.stdout.once('drain', ecrire); }; ecrire();`);
		await expect(lanceurShellReel(shell, [], { env: { PATH: '/usr/bin:/bin' }, delaiMs: 5000 })).rejects.toThrow('sortie de plus de');
	});

	it('code de sortie non nul : rejet', async () => {
		const shell = fauxShell(`process.exit(3);`);
		await expect(lanceurShellReel(shell, [], { env: {}, delaiMs: 5000 })).rejects.toThrow();
	});
});
