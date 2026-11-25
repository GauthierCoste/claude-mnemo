import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { creerPilote } from '../../src/application/pilote.ts';
import type { Session } from '../../src/domaine/session.ts';
import { demarrageMachineMs, etatProcessus, lireLstart, nettoyerRestes } from '../../src/infra/processus.ts';
import { pilotageReel } from '../../src/infra/systeme.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { fauxPorts } from '../aides/faux-ports.ts';
import { fauxTerminaux } from '../aides/faux-terminaux.ts';
import { commandeClaude } from '../aides/moteurs.ts';

const POSIX = process.platform !== 'win32';
const lances: ChildProcess[] = [];
/** Enfants laissés par des chefs de groupe morts : tués en fin de test. */
const enfants: number[] = [];
const fermer: (() => void)[] = [];
afterEach(() => {
	for (const p of lances.splice(0)) p.kill('SIGKILL');
	for (const pid of enfants.splice(0)) {
		try {
			process.kill(pid, 'SIGKILL');
		} catch {
			// déjà mort
		}
	}
	for (const f of fermer.splice(0)) f();
});

/** Un processus vivant qui ne fait rien ; `argv` : ses arguments (visibles par `ps`). */
async function dormeur(...argv: string[]): Promise<number> {
	const p = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', ...argv], { stdio: 'ignore' });
	lances.push(p);
	await new Promise((r) => p.once('spawn', r));
	return p.pid!;
}

function vivant(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (erreur) {
		return (erreur as NodeJS.ErrnoException).code === 'EPERM';
	}
}

const UUID_A = 'a1a1a1a1-0000-4000-8000-000000000001';
const UUID_B = 'b2b2b2b2-0000-4000-8000-000000000002';

describe.skipIf(!POSIX)('etatProcessus : identité d’un pid enregistré', () => {
	it('mort ; session (sa ligne de commande contient l’uuid) ; autre (ligne étrangère, Windows)', async () => {
		const avec = await dormeur('--resume', UUID_A);
		const sans = await dormeur('--autre-chose');
		expect(await etatProcessus(avec, UUID_A)).toBe('session');
		expect(await etatProcessus(avec, UUID_B)).toBe('autre');
		expect(await etatProcessus(sans, UUID_A)).toBe('autre');
		expect(await etatProcessus(avec, UUID_A, 'win32')).toBe('autre');
		lances[0]!.kill('SIGKILL');
		await new Promise((r) => lances[0]!.once('exit', r));
		expect(await etatProcessus(avec, UUID_A)).toBe('mort');
		expect(await etatProcessus(1, UUID_A)).toBe('mort');
	});
});

describe('lireLstart', () => {
	it('lit les deux ordres de ps (locale C), en heure locale', () => {
		expect(lireLstart('Sun Nov 22 13:09:01 2026')).toBe(new Date(2026, 10, 22, 13, 9, 1).getTime());
		expect(lireLstart('Sun 22 Nov 13:09:01 2026')).toBe(new Date(2026, 10, 22, 13, 9, 1).getTime());
		expect(lireLstart('Mon Feb  2 03:04:05 2026')).toBe(new Date(2026, 1, 2, 3, 4, 5).getTime());
		expect(lireLstart('illisible')).toBeNull();
	});
});

/**
 * Un chef de groupe neuf (`setsid`) qui lance un enfant puis meurt : le groupe `chef` ne contient plus que l'enfant. Rend les
 * deux pids, une fois le chef mort.
 */
async function groupeOrphelin(): Promise<{ chef: number; enfant: number }> {
	const code =
		"const { spawn } = require('node:child_process'); const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); c.unref(); process.stdout.write(c.pid + '\\n', () => process.exit(0));";
	const chef = spawn(process.execPath, ['-e', code], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
	lances.push(chef);
	let lu = '';
	chef.stdout!.on('data', (m: Buffer) => {
		lu += m.toString('utf8');
	});
	await new Promise((r) => chef.once('exit', r));
	const enfant = Number(lu.trim());
	enfants.push(enfant);
	return { chef: chef.pid!, enfant };
}

describe.skipIf(!POSIX)('nettoyerRestes : seulement les restes prouvés', () => {
	it('un reste né pendant la vie de la session (même démarrage de la machine) est tué, un par un', async () => {
		const lanceMs = Date.now();
		const { chef, enfant } = await groupeOrphelin();
		expect(vivant(chef)).toBe(false);
		expect(vivant(enfant)).toBe(true);
		await nettoyerRestes({ pid: chef, demarrageMachineMs: demarrageMachineMs(), lanceMs, vuVivantMs: Date.now() });
		expect(vivant(enfant)).toBe(false);
	});

	it('un membre né après le dernier battement (pid réattribué à un nouveau chef mort depuis) n’est PAS signalé', async () => {
		const { chef, enfant } = await groupeOrphelin();
		const maintenant = Date.now();
		await nettoyerRestes({ pid: chef, demarrageMachineMs: demarrageMachineMs(), lanceMs: maintenant - 60_000, vuVivantMs: maintenant - 30_000 });
		expect(vivant(enfant)).toBe(true);
	});

	it('un autre démarrage de la machine : rien n’est signalé', async () => {
		const lanceMs = Date.now();
		const { chef, enfant } = await groupeOrphelin();
		await nettoyerRestes({ pid: chef, demarrageMachineMs: demarrageMachineMs() - 60_000, lanceMs, vuVivantMs: Date.now() });
		expect(vivant(enfant)).toBe(true);
	});

	it('chef vivant, trace incomplète ou Windows : rien n’est signalé', async () => {
		const pid = await dormeur();
		const maintenant = Date.now();
		await nettoyerRestes({ pid, demarrageMachineMs: demarrageMachineMs(), lanceMs: maintenant - 60_000, vuVivantMs: maintenant });
		expect(vivant(pid)).toBe(true);
		const lanceMs = Date.now();
		const { chef, enfant } = await groupeOrphelin();
		await nettoyerRestes({ pid: chef, demarrageMachineMs: null, lanceMs, vuVivantMs: Date.now() });
		await nettoyerRestes({ pid: chef, demarrageMachineMs: demarrageMachineMs(), lanceMs, vuVivantMs: Date.now() }, { plateforme: 'win32' });
		expect(vivant(enfant)).toBe(true);
	});
});

describe.skipIf(!POSIX)('Pilote au démarrage : identité du pid', () => {
	it('pid vivant lancé pour la session → en_pause, jamais signalé ; pid vivant étranger → effacé, session relancée, processus intact', async () => {
		const racine = await dossierTemporaire();
		await mkdir(join(racine, 'alpha'));
		const notre = await dormeur('--session-id', UUID_A);
		const etranger = await dormeur('--autre');
		const terminaux = fauxTerminaux();
		const pil = await pilotageReel(racine, { terminaux });
		fermer.push(() => pil.etat.fermer());
		commandeClaude(pil, { commande: process.execPath, avant: ['faux'] });
		const session = (id: string, pid: number): Session => ({
			id,
			profil: 'travail',
			dossier: 'alpha',
			position: '',
			projet: 'divers',
			objectif: null,
			etat: 'attend',
			creeeMs: 1,
			majMs: 1,
			arretAttendu: null,
			bilanDemandeMs: null,
			commitDebut: null,
			branche: null,
			pid,
		});
		await pil.etat.creer(session(UUID_A, notre));
		await pil.etat.creer(session(UUID_B, etranger));
		const pilote = creerPilote(fauxPorts(), pil);
		expect(await pilote.reprendreAuDemarrage()).toEqual([UUID_B]);
		expect(await pil.etat.lire(UUID_A)).toMatchObject({ etat: 'en_pause', pid: notre });
		const b = await pil.etat.lire(UUID_B);
		expect(b?.pid).toBe(terminaux.lances[0]!.pid);
		expect(terminaux.lances).toHaveLength(1);
		expect(terminaux.lances[0]!.options.args).toContain(UUID_B);
		// aucun des deux n'a reçu de signal
		expect(vivant(notre)).toBe(true);
		expect(vivant(etranger)).toBe(true);
		// la session en pause ne peut pas être reprise tant que son processus vit
		expect(await pilote.reprendre(UUID_A)).toMatchObject({ etat: 'en_pause', pid: notre });
		expect(terminaux.lances).toHaveLength(1);
		await pilote.arreterTout();
	});
});
