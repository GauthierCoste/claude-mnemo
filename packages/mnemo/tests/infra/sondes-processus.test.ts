import { spawn, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { ciblesDuSignal, existenceProcessus, jusqua, signalerGroupe, soiMeme, sonderProcessus } from '../../src/infra/processus.ts';

const PROCESSUS = resolve(import.meta.dirname, '../../src/infra/processus.ts');

const POSIX = process.platform !== 'win32';

describe('sonderProcessus : la seule lecture des processus par un outil du système', () => {
	it('rend la sortie de l’outil, lancé en locale C (dates et noms lisibles partout)', async () => {
		expect(await sonderProcessus(process.execPath, ['-e', 'process.stdout.write(`${process.env.LC_ALL}/${process.env.LANG}`)'])).toBe('C/C');
	});

	it('outil absent ou en échec : null, jamais d’exception', async () => {
		expect(await sonderProcessus('outil-qui-n-existe-pas-mnemo', [])).toBeNull();
		expect(await sonderProcessus(process.execPath, ['-e', 'process.exit(3)'])).toBeNull();
	});
});

describe('existenceProcessus : signal 0, la seule sonde d’existence d’un pid ou d’un groupe', () => {
	it('le processus courant existe ; un processus terminé n’existe plus', () => {
		expect(existenceProcessus(process.pid)).toBe('oui');
		const fini = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
		expect(existenceProcessus(Number(fini.stdout))).toBe('non');
	});

	it.skipIf(!POSIX || process.getuid?.() === 0)('un processus d’un autre utilisateur (pid 1) : interdit, donc vivant', () => {
		expect(existenceProcessus(1)).toBe('interdit');
	});
});

describe('jusqua : la seule attente d’une condition, sondée à intervalle court', () => {
	it('vraie dès qu’elle le devient ; fausse après le délai, sans le dépasser de beaucoup', async () => {
		const debut = Date.now();
		expect(await jusqua(() => Date.now() - debut >= 30, 1000)).toBe(true);
		expect(Date.now() - debut).toBeLessThan(500);
		const t = Date.now();
		expect(await jusqua(() => false, 120)).toBe(false);
		const duree = Date.now() - t;
		expect(duree).toBeGreaterThanOrEqual(115);
		expect(duree).toBeLessThan(400);
	});
});

function tuer(...pids: number[]): void {
	for (const p of pids) {
		try {
			process.kill(p, 'SIGKILL');
		} catch {
			// déjà mort
		}
	}
}

/** Chef d'un groupe à lui (détaché), qui lance un petit-enfant dans le même groupe ; rend les deux pids. */
async function groupeDeDeux(): Promise<{ chef: number; enfant: number }> {
	const chef = spawn(process.execPath, ['-e', "const e = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); process.stdout.write(String(e.pid)); setInterval(() => {}, 1000);"], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
	const enfant = await new Promise<number>((r) => chef.stdout!.once('data', (d: Buffer) => r(Number(String(d)))));
	return { chef: chef.pid!, enfant };
}

describe.skipIf(!POSIX)('signalerGroupe : le seul envoi d’un signal au groupe puis au pid', () => {
	it('POSIX : le groupe entier reçoit le signal', async () => {
		const { chef, enfant } = await groupeDeDeux();
		try {
			signalerGroupe(chef, 'SIGKILL', 'darwin');
			expect(await jusqua(() => existenceProcessus(chef) === 'non' && existenceProcessus(enfant) === 'non', 3000)).toBe(true);
		} finally {
			tuer(enfant, chef);
		}
	});

	it('Windows : le pid seul (pas de groupe de processus)', async () => {
		const { chef, enfant } = await groupeDeDeux();
		try {
			signalerGroupe(chef, 'SIGKILL', 'win32');
			expect(await jusqua(() => existenceProcessus(chef) === 'non', 3000)).toBe(true);
			expect(existenceProcessus(enfant)).toBe('oui');
		} finally {
			tuer(enfant, chef);
		}
	});

	it('un processus qui se vise lui-même (chef de son groupe) : rien n’est envoyé, il survit', async () => {
		const code = `import { signalerGroupe } from ${JSON.stringify(PROCESSUS)}; signalerGroupe(process.pid, 'SIGKILL', process.platform); process.stdout.write('vivant');`;
		const p = spawn(process.execPath, ['--input-type=module', '-e', code], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
		let sortie = '';
		p.stdout!.on('data', (d: Buffer) => (sortie += String(d)));
		const fin = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((r) => p.once('exit', (code, signal) => r({ code, signal })));
		expect(fin).toEqual({ code: 0, signal: null });
		expect(sortie).toBe('vivant');
	});
});

describe('ciblesDuSignal : jamais un pid ou un groupe que Mnemo n’a pas lancé', () => {
	const soi = { pid: 5000, groupe: 4000 };

	it('pid valide : le groupe puis le pid (POSIX), le pid seul (Windows)', () => {
		expect(ciblesDuSignal(6000, 'darwin', soi)).toEqual([-6000, 6000]);
		expect(ciblesDuSignal(6000, 'win32', soi)).toEqual([6000]);
	});

	it('0 (son propre groupe), 1 (-1 : tous les processus de l’utilisateur), négatif, non entier : aucune cible', () => {
		for (const pid of [0, 1, -1, -6000, Number.NaN, 1.5, Number.POSITIVE_INFINITY]) {
			expect(ciblesDuSignal(pid, 'darwin', soi), String(pid)).toEqual([]);
			expect(ciblesDuSignal(pid, 'win32', soi), String(pid)).toEqual([]);
		}
	});

	it('soi-même, ou le chef de son propre groupe (le groupe du processus de test) : aucune cible', () => {
		expect(ciblesDuSignal(soi.pid, 'darwin', soi)).toEqual([]);
		expect(ciblesDuSignal(soi.groupe, 'darwin', soi)).toEqual([]);
		expect(ciblesDuSignal(soi.pid, 'win32', soi)).toEqual([]);
	});

	it('groupe propre inconnu (POSIX) : le pid seul, jamais un groupe', () => {
		expect(ciblesDuSignal(6000, 'darwin', { pid: 5000, groupe: null })).toEqual([6000]);
	});

	it.skipIf(!POSIX)('soiMeme : le pid courant et son vrai groupe (lu par ps)', () => {
		const lu = Number(spawnSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' }).stdout.trim());
		expect(soiMeme()).toEqual({ pid: process.pid, groupe: lu });
	});
});
