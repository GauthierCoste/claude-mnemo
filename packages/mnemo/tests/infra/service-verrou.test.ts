import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { demarrageMachineMs } from '../../src/infra/processus.ts';
import { estLigneDuService, prendreVerrouService } from '../../src/infra/verrou-service.ts';
import { COMMANDES_CLI } from '../../src/domaine/commandes.ts';
import { preparerDossierLocal } from '../../src/infra/systeme.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

const enfants: ChildProcess[] = [];
afterEach(() => {
	for (const e of enfants.splice(0)) e.kill('SIGKILL');
});

/** Un pid qui n'existe pas (au-delà des pids possibles). */
const PID_MORT = 99_999_999;
const VERROU_SERVICE = resolve(import.meta.dirname, '../../src/infra/verrou-service.ts');

async function racineAvecVerrou(contenu: unknown, fichier = 'service.verrou'): Promise<{ racine: string; chemin: string }> {
	const racine = await dossierTemporaire();
	const chemin = join(preparerDossierLocal(racine), fichier);
	writeFileSync(chemin, typeof contenu === 'string' ? contenu : JSON.stringify(contenu));
	return { racine, chemin };
}

/** Script exécutable nommé `mnemo` (ligne de commande d'un service : `node …/mnemo <dossier>`). */
async function scriptMnemo(code: string): Promise<string> {
	const dossier = join(await dossierTemporaire(), 'bin');
	await mkdir(dossier);
	const chemin = join(dossier, 'mnemo');
	writeFileSync(chemin, code);
	return chemin;
}

/** Processus vivant dont la ligne de commande est celle d'un service Mnemo ; `lanceMs` : son lancement. */
async function fauxService(): Promise<{ pid: number; lanceMs: number }> {
	const script = await scriptMnemo('setInterval(() => {}, 1000);\n');
	const lanceMs = Date.now();
	const e = spawn(process.execPath, [script, '/un/dossier'], { stdio: 'ignore' });
	enfants.push(e);
	await new Promise((r) => setTimeout(r, 300));
	return { pid: e.pid!, lanceMs };
}

describe('verrou du service : propriétaire identifié', () => {
	it('écrit { pid, demarrageMachineMs, lanceMs } ; un second essai du même processus est refusé', async () => {
		const racine = await dossierTemporaire();
		preparerDossierLocal(racine);
		const v = await prendreVerrouService(racine);
		expect(v.pris).toBe(true);
		const lu = JSON.parse(readFileSync(join(racine, '.mnemo', 'service.verrou'), 'utf8')) as Record<string, unknown>;
		expect(lu).toMatchObject({ pid: process.pid, demarrageMachineMs: expect.any(Number), lanceMs: expect.any(Number) });
		expect(await prendreVerrouService(racine)).toEqual({ pris: false, pid: process.pid });
		if (v.pris) {
			expect(v.tenu()).toBe(true);
			v.liberer();
			expect(v.tenu()).toBe(false);
		}
	});

	it('ligne de commande : seul `mnemo` en mode service (sans argument ou un dossier) compte', () => {
		expect(estLigneDuService('node /opt/mnemo/packages/mnemo/src/adaptateurs/cli/main.ts')).toBe(true);
		expect(estLigneDuService('node /Users/x/bin/mnemo /Users/x/Notes')).toBe(true);
		expect(estLigneDuService('/usr/local/bin/node /usr/local/bin/mnemo')).toBe(true);
		expect(estLigneDuService('node /Users/x/bin/mnemo hook')).toBe(false);
		expect(estLigneDuService('node /Users/x/bin/mnemo mcp')).toBe(false);
		expect(estLigneDuService('node /Users/x/bin/mnemo session voir abc')).toBe(false);
		expect(estLigneDuService('vim /Users/x/notes/mnemo-service.md')).toBe(false);
		expect(estLigneDuService('/sbin/launchd')).toBe(false);
	});

	it('pid vivant étranger (pid 1, pas un service Mnemo) : repris aussitôt', async () => {
		const { racine } = await racineAvecVerrou({ pid: 1, demarrageMachineMs: demarrageMachineMs(), lanceMs: Date.now() });
		const debut = Date.now();
		const v = await prendreVerrouService(racine);
		expect(v.pris).toBe(true);
		expect(Date.now() - debut).toBeLessThan(3000);
	});

	it('service vivant : gardé ; même pid mais autre démarrage de la machine, ou lancé à un autre instant (pid recyclé) : repris', async () => {
		const { pid, lanceMs } = await fauxService();
		const vivant = await racineAvecVerrou({ pid, demarrageMachineMs: demarrageMachineMs(), lanceMs });
		expect(await prendreVerrouService(vivant.racine)).toEqual({ pris: false, pid });
		const ancien = await racineAvecVerrou({ pid, demarrageMachineMs: demarrageMachineMs() - 86_400_000, lanceMs: lanceMs - 86_400_000 });
		expect((await prendreVerrouService(ancien.racine)).pris).toBe(true);
		const recycle = await racineAvecVerrou({ pid, demarrageMachineMs: demarrageMachineMs(), lanceMs: lanceMs - 60_000 });
		expect((await prendreVerrouService(recycle.racine)).pris).toBe(true);
	});

	it('ancien format (pid seul) d’un mort : repris', async () => {
		const { racine } = await racineAvecVerrou(`${PID_MORT}\n`);
		expect((await prendreVerrouService(racine)).pris).toBe(true);
	});

	it('deux services reprennent le même verrou mort : un seul gagne', async () => {
		for (let essai = 0; essai < 5; essai++) {
			const { racine, chemin } = await racineAvecVerrou({ pid: PID_MORT, demarrageMachineMs: demarrageMachineMs(), lanceMs: 1 });
			const resultats = await Promise.all([prendreVerrouService(racine), prendreVerrouService(racine), prendreVerrouService(racine)]);
			expect(resultats.filter((r) => r.pris)).toHaveLength(1);
			expect(JSON.parse(readFileSync(chemin, 'utf8'))).toMatchObject({ pid: process.pid });
		}
	});

	it('reprise en cours laissée par un mort (`.reprise`) : reprise à son tour ; tenue par un service vivant : attente puis refus', async () => {
		const mort = { pid: PID_MORT, demarrageMachineMs: demarrageMachineMs(), lanceMs: 1 };
		const { racine } = await racineAvecVerrou(mort);
		writeFileSync(join(racine, '.mnemo', 'service.verrou.reprise'), JSON.stringify(mort));
		expect((await prendreVerrouService(racine, { attenteMaxMs: 3000 })).pris).toBe(true);
		expect(existsSync(join(racine, '.mnemo', 'service.verrou.reprise'))).toBe(false);

		const { pid, lanceMs } = await fauxService();
		const occupe = await racineAvecVerrou(mort);
		writeFileSync(join(occupe.racine, '.mnemo', 'service.verrou.reprise'), JSON.stringify({ pid, demarrageMachineMs: demarrageMachineMs(), lanceMs }));
		const debut = Date.now();
		expect((await prendreVerrouService(occupe.racine, { attenteMaxMs: 600 })).pris).toBe(false);
		expect(Date.now() - debut).toBeGreaterThanOrEqual(500);
	});

	it('reprise concurrente entre processus, renommage retardé de 400 ms : un seul service survit', { timeout: 30_000 }, async () => {
		// technique du relecteur : `fs.renameSync` retardé (arrêt de l'ordonnanceur entre le constat et le renommage)
		const script = await scriptMnemo(`import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const [racine, retardMs] = [process.argv[2], Number(process.argv[3])];
if (retardMs > 0) {
	const vrai = fs.renameSync;
	fs.renameSync = (a, b) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, retardMs); return vrai(a, b); };
	syncBuiltinESMExports();
}
const { prendreVerrouService } = await import(${JSON.stringify(VERROU_SERVICE)});
const v = await prendreVerrouService(racine);
console.log(JSON.stringify({ pid: process.pid, pris: v.pris }));
await new Promise((r) => setTimeout(r, 1500));
console.log(JSON.stringify({ tenu: v.pris ? v.tenu() : false }));
`);
		for (let essai = 0; essai < 3; essai++) {
			const { racine, chemin } = await racineAvecVerrou({ pid: PID_MORT, demarrageMachineMs: demarrageMachineMs(), lanceMs: 1 });
			const lancer = (retard: number) =>
				new Promise<{ pid: number; pris: boolean; tenu: boolean }>((resoudre, rejeter) => {
					const e = spawn(process.execPath, [script, racine, String(retard)], { stdio: ['ignore', 'pipe', 'pipe'] });
					enfants.push(e);
					let sortie = '';
					let erreurs = '';
					e.stdout!.on('data', (d) => (sortie += d));
					e.stderr!.on('data', (d) => (erreurs += d));
					e.on('error', rejeter);
					e.on('close', () => {
						const lignes = sortie.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
						if (lignes.length < 2) return rejeter(new Error(`sortie incomplète : ${sortie} ${erreurs}`));
						resoudre({ ...(lignes[0] as { pid: number; pris: boolean }), tenu: lignes[1]!.tenu as boolean });
					});
				});
			const resultats = await Promise.all([lancer(0), lancer(400), lancer(400)]);
			const gagnants = resultats.filter((r) => r.pris);
			expect(gagnants, JSON.stringify(resultats)).toHaveLength(1);
			expect(gagnants[0]!.tenu).toBe(true);
			expect(JSON.parse(readFileSync(chemin, 'utf8'))).toMatchObject({ pid: gagnants[0]!.pid });
		}
	});

	const temporaires = (racine: string) => readdirSync(join(racine, '.mnemo')).filter((n) => n.endsWith('.tmp') || n.endsWith('.mort'));

	it('verrou illisible (dossier, droits 000) : refus clair qui nomme le fichier, en moins d’1 s, sans fichier temporaire laissé', async () => {
		const dossier = await dossierTemporaire();
		mkdirSync(join(preparerDossierLocal(dossier), 'service.verrou'));
		let debut = Date.now();
		await expect(prendreVerrouService(dossier)).rejects.toThrow(/service\.verrou.*illisible|illisible.*service\.verrou/u);
		expect(Date.now() - debut).toBeLessThan(1000);
		expect(temporaires(dossier)).toEqual([]);

		if (process.platform !== 'win32' && process.getuid?.() !== 0) {
			const { racine, chemin } = await racineAvecVerrou({ pid: PID_MORT, demarrageMachineMs: 0, lanceMs: 1 });
			chmodSync(chemin, 0o000);
			try {
				debut = Date.now();
				await expect(prendreVerrouService(racine)).rejects.toThrow(/service\.verrou/u);
				expect(Date.now() - debut).toBeLessThan(1000);
				expect(temporaires(racine)).toEqual([]);
			} finally {
				chmodSync(chemin, 0o600);
			}
		}
	});

	it('tenu() : un échec de lecture passager (EMFILE) n’est pas une perte ; contenu autre ou fichier absent, si', async () => {
		const racine = await dossierTemporaire();
		preparerDossierLocal(racine);
		const v = await prendreVerrouService(racine);
		if (!v.pris) throw new Error('verrou attendu');
		const vrai = fs.readFileSync;
		fs.readFileSync = ((...a: Parameters<typeof vrai>) => {
			if (String(a[0]).endsWith('service.verrou')) throw Object.assign(new Error('trop de fichiers'), { code: 'EMFILE' });
			return vrai(...a);
		}) as typeof vrai;
		syncBuiltinESMExports();
		try {
			expect(v.tenu()).toBe(true);
		} finally {
			fs.readFileSync = vrai;
			syncBuiltinESMExports();
		}
		const chemin = join(racine, '.mnemo', 'service.verrou');
		writeFileSync(chemin, '{"pid":1}');
		expect(v.tenu()).toBe(false);
		fs.rmSync(chemin);
		expect(v.tenu()).toBe(false);
	});

	it('`.reprise.casse` laissée par un mort : reprise ; un seul gagnant', async () => {
		const mort = { pid: PID_MORT, demarrageMachineMs: demarrageMachineMs(), lanceMs: 1 };
		const { racine } = await racineAvecVerrou(mort);
		writeFileSync(join(racine, '.mnemo', 'service.verrou.reprise'), JSON.stringify({ ...mort, jeton: 'r' }));
		writeFileSync(join(racine, '.mnemo', 'service.verrou.reprise.casse'), JSON.stringify({ ...mort, jeton: 'c' }));
		const resultats = await Promise.all([prendreVerrouService(racine, { attenteMaxMs: 3000 }), prendreVerrouService(racine, { attenteMaxMs: 3000 })]);
		expect(resultats.filter((r) => r.pris)).toHaveLength(1);
		expect(existsSync(join(racine, '.mnemo', 'service.verrou.reprise'))).toBe(false);
		expect(existsSync(join(racine, '.mnemo', 'service.verrou.reprise.casse'))).toBe(false);
		expect(temporaires(racine)).toEqual([]);
	});

	it('cassure d’une `.reprise` morte, trois démarrages (scénario du relecteur, retards injectés) : un seul gagnant', { timeout: 90_000 }, async () => {
		const script = await scriptMnemo(`import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const dort = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const n = (k) => Number(process.env[k] || 0);
const r = n('STALL_RENAME_MS'), u = n('STALL_UNLINK_REPRISE_MS'), l = n('STALL_LINK_REPRISE_MS');
const vraiRename = fs.renameSync, vraiUnlink = fs.unlinkSync, vraiLink = fs.linkSync;
fs.renameSync = (a, b) => { if (r > 0 && String(b).endsWith('service.verrou')) dort(r); return vraiRename(a, b); };
fs.unlinkSync = (a) => { if (u > 0 && String(a).endsWith('service.verrou.reprise')) dort(u); return vraiUnlink(a); };
fs.linkSync = (a, b) => { if (l > 0 && String(b).endsWith('service.verrou.reprise')) dort(l); return vraiLink(a, b); };
syncBuiltinESMExports();
const { prendreVerrouService } = await import(${JSON.stringify(VERROU_SERVICE)});
const v = await prendreVerrouService(process.argv[2]);
console.log(JSON.stringify({ pid: process.pid, pris: v.pris }));
// le gagnant reste en vie : un démarrage décalé le trouve vivant (jamais un verrou mort repris plus tard)
await new Promise((r) => setTimeout(r, 4000));
console.log(JSON.stringify({ tenu: v.pris ? v.tenu() : false }));
`);
		for (const decalage of [0, 400, 800, 1600]) {
			const mort = JSON.stringify({ pid: PID_MORT, demarrageMachineMs: demarrageMachineMs(), lanceMs: 1, jeton: 'mort' });
			const { racine, chemin } = await racineAvecVerrou(mort);
			writeFileSync(join(racine, '.mnemo', 'service.verrou.reprise'), mort.replace('"mort"', '"mort2"'));
			const lancer = (env: Record<string, string>, apresMs: number) =>
				new Promise<{ pid: number; pris: boolean; tenu: boolean }>((resoudre, rejeter) => {
					setTimeout(() => {
						const e = spawn(process.execPath, [script, racine], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
						enfants.push(e);
						let sortie = '';
						let erreurs = '';
						e.stdout!.on('data', (d) => (sortie += d));
						e.stderr!.on('data', (d) => (erreurs += d));
						e.on('error', rejeter);
						e.on('close', () => {
							const lignes = sortie.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
							if (lignes.length < 2) return rejeter(new Error(`sortie incomplète : ${sortie} ${erreurs}`));
							resoudre({ ...(lignes[0] as { pid: number; pris: boolean }), tenu: lignes[1]!.tenu as boolean });
						});
					}, apresMs);
				});
			const resultats = await Promise.all([
				lancer({ STALL_RENAME_MS: '2000' }, 0),
				lancer({ STALL_UNLINK_REPRISE_MS: '400', STALL_LINK_REPRISE_MS: '300' }, 0),
				lancer({}, decalage),
			]);
			const gagnants = resultats.filter((r) => r.pris);
			expect(gagnants, `décalage ${decalage} : ${JSON.stringify(resultats)}`).toHaveLength(1);
			expect(gagnants[0]!.tenu).toBe(true);
			expect(JSON.parse(readFileSync(chemin, 'utf8'))).toMatchObject({ pid: gagnants[0]!.pid });
			expect(temporaires(racine)).toEqual([]);
		}
	});

	it('une seule liste des commandes : celle de main.ts', () => {
		const main = readFileSync(resolve(import.meta.dirname, '../../src/adaptateurs/cli/main.ts'), 'utf8');
		expect(main).toMatch(/\{ COMMANDES_CLI \} = await import\('\.\.\/\.\.\/domaine\/commandes\.ts'\)/u);
		const verrou = readFileSync(VERROU_SERVICE, 'utf8');
		expect(verrou).toMatch(/COMMANDES_CLI/u);
		expect(verrou).not.toMatch(/new Set\(\['aide'/u);
		const cas = [...main.matchAll(/case '([^']+)':/gu)].map((m) => m[1]).sort();
		expect(cas).toEqual([...COMMANDES_CLI].sort());
	});
});
