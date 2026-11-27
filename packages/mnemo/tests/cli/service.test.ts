import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { initialiser } from '../../src/application/initialiser.ts';
import { dependancesReelles } from '../../src/infra/systeme.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { jusqua } from '../aides/service-faux.ts';

const MAIN = resolve(import.meta.dirname, '../../src/adaptateurs/cli/main.ts');

const enfants: ChildProcess[] = [];
afterEach(() => {
	for (const e of enfants.splice(0)) {
		if (e.exitCode === null && e.signalCode === null) e.kill('SIGKILL');
	}
});

/** `claude` introuvable : les sessions se lancent en mode manuel (aucun processus), jamais de navigateur. */
const env = (home: string) => ({ ...process.env, HOME: home, MNEMO_CLAUDE: join(home, 'aucun-claude'), MNEMO_SANS_NAVIGATEUR: '1', MNEMO_SANS_MCP: '1' });

function mnemo(cwd: string, home: string, ...args: string[]): Promise<{ code: number; out: string; err: string }> {
	return new Promise((resoudre) => {
		execFile(process.execPath, [MAIN, ...args], { cwd, env: env(home), timeout: 60_000 }, (erreur, out, err) => {
			resoudre({ code: erreur === null ? 0 : typeof erreur.code === 'number' ? erreur.code : 1, out, err });
		});
	});
}

async function dossierMnemo(): Promise<string> {
	const racine = await dossierTemporaire();
	const schema = await readFile(join(import.meta.dirname, '../../modeles/SCHEMA.md'), 'utf8');
	const dep = dependancesReelles(racine);
	try {
		await initialiser(dep, schema);
	} finally {
		dep.index.fermer();
	}
	await mkdir(join(racine, 'alpha'));
	return racine;
}

describe('mnemo [dossier]', () => {
	it('sans argument hors d’une mémoire : l’aide ; un dossier sans mémoire : erreur lisible', async () => {
		const vide = await dossierTemporaire();
		const home = await dossierTemporaire();
		const aide = await mnemo(vide, home);
		expect(aide.code).toBe(0);
		expect(aide.out).toContain('Usage');
		const sans = await mnemo(vide, home, vide);
		expect(sans.code).toBe(1);
		expect(sans.err).toMatch(/Aucune mémoire Mnemo/u);
		// ni commande ni dossier : commande inconnue
		expect((await mnemo(vide, home, 'nimporte-quoi')).code).toBe(2);
	});

	it('sessions sans service : erreur lisible', async () => {
		const racine = await dossierMnemo();
		const home = await dossierTemporaire();
		const r = await mnemo(racine, home, 'sessions');
		expect(r.code).toBe(1);
		expect(r.err).toMatch(/Aucun service Mnemo/u);
	});

	it('service lancé sans argument depuis un sous-dossier ; CLI des sessions : lancer (manuel), sessions, terminer --sans-bilan', async () => {
		const racine = await dossierMnemo();
		const home = await dossierTemporaire();
		const service = spawn(process.execPath, [MAIN], { cwd: join(racine, 'alpha'), env: env(home), stdio: ['ignore', 'pipe', 'pipe'] });
		enfants.push(service);
		let sortie = '';
		service.stdout!.on('data', (m: Buffer) => {
			sortie += m.toString('utf8');
		});
		expect(await jusqua(() => /http:\/\/127\.0\.0\.1:\d+\//u.test(sortie), 30_000)).toBe(true);
		// sortie redirigée : jamais le jeton (il n'est donné que dans un terminal, ou par « mnemo jeton »)
		expect(sortie).not.toMatch(/#jeton=|[0-9a-f]{64}/u);

		const lance = await mnemo(join(racine, 'alpha'), home, 'session', 'lancer', 'alpha', '--objectif', 'Refaire le catalogue');
		expect(lance.code, lance.err).toBe(0);
		const id = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/u.exec(lance.out)?.[0];
		expect(id).toBeDefined();
		// claude introuvable : la ligne de commande à coller
		expect(lance.out).toContain('--session-id');

		const liste = await mnemo(racine, home, 'sessions');
		expect(liste.code).toBe(0);
		expect(liste.out).toContain(id);
		expect(liste.out).toContain('alpha');

		const fin = await mnemo(racine, home, 'session', 'terminer', id!.slice(0, 8), '--sans-bilan');
		expect(fin.code, fin.err).toBe(0);
		expect(fin.out).toMatch(/terminee/u);
		expect((await mnemo(racine, home, 'sessions')).out).not.toContain(id);
		const encore = await mnemo(racine, home, 'session', 'terminer', id!, '--sans-bilan');
		expect(encore.code).toBe(1);
		expect(encore.err).toMatch(/Session déjà terminée/u);

		expect((await mnemo(racine, home, 'session', 'terminer', '00000000')).code).toBe(1);
		expect((await mnemo(racine, home, 'session', 'pirouette')).code).toBe(2);

		// arrêt propre : SIGTERM, ou `mnemo arreter` sous Windows (un signal y tue sans arrêt propre, code null)
		const sorti = new Promise((r) => service.once('exit', (code) => r(code)));
		if (process.platform === 'win32') expect((await mnemo(racine, home, 'arreter')).code).toBe(0);
		else service.kill('SIGTERM');
		expect(await sorti).toBe(0);
	}, 120_000);
});
