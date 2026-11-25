import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { creerPilote } from '../../src/application/pilote.ts';
import type { Pilote } from '../../src/application/pilote.ts';
import type { EtatSessions, Pilotage, Terminal } from '../../src/application/ports.ts';
import { ecrirePlugin } from '../../src/infra/plugin-fichiers.ts';
import { ouvrirEtat } from '../../src/infra/etat-sqlite.ts';
import { demarrageMachineMs, etatProcessus, nettoyerRestes, signalerGroupe } from '../../src/infra/processus.ts';
import { dependancesReelles, pilotageReel } from '../../src/infra/systeme.ts';
import { terminauxPty } from '../../src/infra/terminaux-pty.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { DEPOT_ABSENT, fauxPorts } from '../aides/faux-ports.ts';
import { versionMnemo } from '../../src/infra/version.ts';
import { commandeClaude, moteursDeTest } from '../aides/moteurs.ts';

const FAUX_CLAUDE = resolve(import.meta.dirname, '../aides/faux-claude.mjs');
const SERVICE = resolve(import.meta.dirname, '../aides/service-pilote.ts');
const POSIX = process.platform !== 'win32';

const terminaux = await terminauxPty({ delaiArretMs: 400 });
const dispo = terminaux.disponibles();
// node-pty absent : tests sautés en local, échec en CI (`CI` défini)
const sauter = !dispo.ok && process.env.CI === undefined;

/** Tous les pids lancés par un test (processus de session et leurs enfants) : tués en fin de test, même en cas d'échec. */
const pids = new Set<number>();
const pilotes: Pilote[] = [];
const etats: EtatSessions[] = [];
afterEach(async () => {
	while (pilotes.length > 0) await pilotes.pop()!.arreterTout().catch(() => {});
	for (const pid of pids) signalerGroupe(pid, 'SIGKILL', process.platform);
	pids.clear();
	while (etats.length > 0) etats.pop()!.fermer();
});

function vivant(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (erreur) {
		return (erreur as NodeJS.ErrnoException).code === 'EPERM';
	}
}

/** Processus du groupe `pgid` (POSIX), d'après `ps`. */
function groupe(pgid: number): number[] {
	const sortie = execFileSync('ps', ['-A', '-o', 'pid=,pgid='], { encoding: 'utf8' });
	return sortie
		.split('\n')
		.map((l) => l.trim().split(/\s+/u).map(Number))
		.filter(([pid, g]) => g === pgid && pid !== undefined && !Number.isNaN(pid))
		.map(([pid]) => pid!);
}

/** Aucun survivant : ni le processus, ni ses enfants, ni rien dans son groupe. */
function aucunSurvivant(...liste: number[]): void {
	for (const pid of liste) {
		expect(vivant(pid), `pid ${pid}`).toBe(false);
		if (POSIX) expect(groupe(pid), `groupe ${pid}`).toEqual([]);
	}
}

type Suivi = { texte: () => string; attendre: (motif: RegExp, maxMs?: number) => Promise<RegExpExecArray> };

function suivre(t: Pick<Terminal, 'surSortie'>): Suivi {
	let tout = '';
	t.surSortie((d) => {
		tout += d;
	});
	return {
		texte: () => tout,
		async attendre(motif, maxMs = 10_000) {
			const fin = Date.now() + maxMs;
			for (;;) {
				const m = motif.exec(tout);
				if (m !== null) return m;
				if (Date.now() > fin) throw new Error(`« ${motif} » jamais vu ; sortie :\n${tout}`);
				await new Promise((r) => setTimeout(r, 20));
			}
		},
	};
}

/** Un plugin dont chaque hook appelle `journal.mjs` (exec, sans shell), qui note l'événement reçu et refuse l'outil `Interdit`. */
async function pluginDeTest(dossier: string): Promise<{ plugin: string; journal: string }> {
	const plugin = join(dossier, 'plugin');
	const journal = join(dossier, 'journal.jsonl');
	const script = join(dossier, 'journal.mjs');
	await writeFile(
		script,
		[
			"import { appendFileSync } from 'node:fs';",
			'let brut = "";',
			"process.stdin.on('data', (m) => { brut += m; });",
			"process.stdin.on('end', () => {",
			'  const e = JSON.parse(brut);',
			`  appendFileSync(${JSON.stringify(journal)}, JSON.stringify({ argv: process.argv.slice(2), entree: e, session: process.env.MNEMO_SESSION ?? null }) + "\\n");`,
			"  if (e.tool_name === 'Interdit') process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'consigne' } }));",
			'});',
		].join('\n'),
	);
	const commande = (e: string) => ({ type: 'command', command: process.execPath, args: [script, e], timeout: 5 });
	const hooks = {
		SessionStart: [{ hooks: [commande('debut')] }],
		UserPromptSubmit: [{ hooks: [commande('message')] }],
		PreToolUse: [{ matcher: '*', hooks: [commande('outil')] }],
		Stop: [{ hooks: [commande('arret')] }],
		SessionEnd: [{ hooks: [commande('fin')] }],
	};
	await mkdir(join(plugin, 'hooks'), { recursive: true });
	await writeFile(join(plugin, 'hooks', 'hooks.json'), JSON.stringify({ hooks }));
	return { plugin, journal };
}

async function lireJournal(journal: string): Promise<{ argv: string[]; entree: Record<string, unknown>; session: string | null }[]> {
	try {
		return (await readFile(journal, 'utf8'))
			.split('\n')
			.filter((l) => l !== '')
			.map((l) => JSON.parse(l));
	} catch {
		return [];
	}
}

function lancerFaux(dossier: string, args: string[], env: Record<string, string> = {}): Terminal {
	const t = terminaux.lancer({ commande: process.execPath, args: [FAUX_CLAUDE, ...args], dossier, env: { ...(process.env as Record<string, string>), ...env }, colonnes: 120, lignes: 32 });
	pids.add(t.pid);
	return t;
}

const ID = '0f1e2d3c-4b5a-4968-8776-655443322110';

describe('terminaux-pty : chargement', () => {
	it('node-pty se charge (exigé en CI)', () => {
		if (process.env.CI !== undefined) expect(dispo).toEqual({ ok: true });
	});

	it('node-pty illoadable : mode dégradé avec le motif, lancer refuse', async () => {
		const degrade = await terminauxPty({
			charger: async () => {
				throw new Error('Cannot find module node-pty');
			},
		});
		const d = degrade.disponibles();
		expect(d.ok).toBe(false);
		if (!d.ok) expect(d.motif).toMatch(/^node-pty n'est pas installé : Cannot find module node-pty ; voir docs\/installation\.md$/u);
		expect(() => degrade.lancer({ commande: 'x', args: [], dossier: '/', env: {}, colonnes: 80, lignes: 24 })).toThrow(/node-pty/u);
	});
});

describe.skipIf(sauter)('terminaux-pty : faux-claude sous un vrai pseudo-terminal', () => {
	it('arguments, dossier, environnement, taille ; hooks exec sans shell ; écho, décision, /exit → SessionEnd ; arreter résout', async () => {
		const dossier = await dossierTemporaire();
		const { plugin, journal } = await pluginDeTest(dossier);
		const t = lancerFaux(dossier, ['--session-id', ID, '--plugin-dir', plugin], { MNEMO_SESSION: ID });
		const s = suivre(t);
		const fins: (number | null)[] = [];
		t.surFin((code) => fins.push(code));
		await s.attendre(/prêt/u);
		expect(s.texte()).toContain(`faux-claude ${JSON.stringify(['--session-id', ID, '--plugin-dir', plugin])}`);
		expect(s.texte()).toContain(`env MNEMO_SESSION=${ID}`);
		expect(s.texte()).toContain('taille 120x32');
		expect(s.texte()).toMatch(/cwd .*mnemo-test-/u);
		t.redimensionner(100, 40);
		await s.attendre(/taille 100x40/u);
		t.ecrire('bonjour\r');
		await s.attendre(/écho: bonjour/u);
		t.ecrire('outil:Interdit {"x":1}\r');
		await s.attendre(/décision: deny \(consigne\)/u);
		t.ecrire('outil:Permis {}\r');
		await s.attendre(/décision: allow/u);
		// une saisie commencée est effacée (Ctrl-U) avant `/exit`
		t.ecrire('brouillon');
		await t.arreter();
		expect(s.texte()).toContain('au revoir');
		expect(fins).toEqual([0]);
		const evenements = await lireJournal(journal);
		expect(evenements.map((e) => e.entree.hook_event_name)).toEqual(['SessionStart', 'UserPromptSubmit', 'Stop', 'PreToolUse', 'PreToolUse', 'SessionEnd']);
		for (const e of evenements) expect(e.entree).toMatchObject({ session_id: ID, cwd: expect.stringContaining('mnemo-test-') });
		expect(evenements[1]!.entree.prompt).toBe('bonjour');
		expect(evenements[3]!.entree).toMatchObject({ tool_name: 'Interdit', tool_input: { x: 1 } });
		expect(evenements[5]!.entree.reason).toBe('prompt_input_exit');
		expect(evenements[0]!.session).toBe(ID);
		aucunSurvivant(t.pid);
		// un second arreter ne relance rien
		await t.arreter();
	});

	it('arreter : octets envoyés — Ctrl-U, /exit, Entrée ; avec echap, Échap seul d’abord puis 150 ms au moins', async () => {
		// un processus en mode brut qui affiche chaque morceau reçu (hexadécimal, instant) et sort à `/exit` + Entrée
		const code = [
			'process.stdin.setRawMode(true);',
			"let tout = '';",
			"process.stdin.on('data', (d) => {",
			"  process.stdout.write(`recu ${Date.now()} ${d.toString('hex')}\\r\\n`);",
			"  tout += d.toString('latin1');",
			"  if (tout.includes('/exit\\r')) setTimeout(() => process.exit(0), 20);",
			'});',
			"process.stdout.write('pret\\r\\n');",
		].join('\n');
		const recus = async (echap: boolean): Promise<{ instant: number; octets: string }[]> => {
			const dossier = await dossierTemporaire();
			const t = terminaux.lancer({ commande: process.execPath, args: ['-e', code], dossier, env: { ...(process.env as Record<string, string>) }, colonnes: 80, lignes: 24 });
			pids.add(t.pid);
			const s = suivre(t);
			await s.attendre(/pret/u);
			await t.arreter(2000, { echap });
			return [...s.texte().matchAll(/recu (\d+) ([0-9a-f]+)/gu)].map((m) => ({ instant: Number(m[1]), octets: m[2]! }));
		};
		const sans = await recus(false);
		const tousSans = sans.map((r) => r.octets).join('');
		expect(tousSans).toBe(Buffer.from('\x15/exit\r', 'latin1').toString('hex'));
		const avec = await recus(true);
		expect(avec[0]!.octets).toBe('1b');
		expect(avec.slice(1).map((r) => r.octets).join('')).toBe(Buffer.from('\x15/exit\r', 'latin1').toString('hex'));
		expect(avec[1]!.instant - avec[0]!.instant).toBeGreaterThanOrEqual(140);
	});

	it('--tetu ignore /exit et SIGTERM : tué au SIGKILL 3 s après, lui et son enfant', async () => {
		const dossier = await dossierTemporaire();
		const t = lancerFaux(dossier, ['--tetu', '--enfant']);
		const s = suivre(t);
		const enfant = Number((await s.attendre(/enfant (\d+)\s/u))[1]);
		pids.add(enfant);
		await s.attendre(/prêt/u);
		const fins: (number | null)[] = [];
		t.surFin((code) => fins.push(code));
		const debut = Date.now();
		await t.arreter(200);
		const duree = Date.now() - debut;
		expect(s.texte()).toContain('/exit ignoré');
		expect(s.texte()).toContain('SIGTERM ignoré');
		expect(duree).toBeGreaterThanOrEqual(3000);
		expect(duree).toBeLessThan(8000);
		expect(fins).toHaveLength(1);
		aucunSurvivant(t.pid, enfant);
	}, 15_000);

	it('sorti sur /exit en laissant un enfant têtu : le reste du groupe est tué aussi', async () => {
		const dossier = await dossierTemporaire();
		const t = lancerFaux(dossier, ['--enfant']);
		const s = suivre(t);
		const enfant = Number((await s.attendre(/enfant (\d+)\s/u))[1]);
		pids.add(enfant);
		await s.attendre(/prêt/u);
		await t.arreter(2000);
		expect(s.texte()).toContain('au revoir');
		aucunSurvivant(t.pid, enfant);
	}, 15_000);

	it('--bavard : 5 Mo de sortie lus sans blocage', async () => {
		const dossier = await dossierTemporaire();
		const t = lancerFaux(dossier, ['--bavard', '5']);
		let octets = 0;
		t.surSortie((d) => {
			octets += d.length;
		});
		const s = suivre(t);
		await s.attendre(/prêt/u, 20_000);
		expect(octets).toBeGreaterThan(5 * 1024 * 1024);
		await t.arreter();
		aucunSurvivant(t.pid);
	}, 30_000);
});

describe.skipIf(sauter)('Pilote sous de vrais pseudo-terminaux : aucun orphelin', () => {
	it('arreterTout : plus aucun processus de session ni de ses enfants (dont un têtu)', async () => {
		const racine = await dossierTemporaire();
		await mkdir(join(racine, 'alpha'));
		await mkdir(join(racine, 'beta'));
		const { journal } = await pluginDeTest(racine);
		const etat = ouvrirEtat(join(racine, 'etat.sqlite'));
		etats.push(etat);
		const base = (avant: string[]): Pilotage => ({
			etat,
			terminaux,
			depot: DEPOT_ABSENT,
			plugin: {
				ecrire: (session, fichiers) => ecrirePlugin(racine, session, fichiers),
				retirer: async () => {},
				appel: { node: process.execPath, main: join(racine, 'journal.mjs'), version: '0.0.0-essai' },
				racine,
			},
			moteurs: moteursDeTest({ commande: process.execPath, avant: [FAUX_CLAUDE, ...avant] }),
			hote: { env: process.env, plateforme: process.platform, dossier: async (r) => ({ absolu: join(racine, r), reel: r }), processus: etatProcessus, demarrageMachineMs, nettoyerRestes },
		});
		const dep = fauxPorts();
		const tetu = creerPilote(dep, base(['--tetu', '--enfant']));
		const sage = creerPilote(dep, base(['--enfant']));
		pilotes.push(tetu, sage);
		const sessions: { id: string; pid: number; enfant: number }[] = [];
		for (const [pilote, dossier] of [
			[tetu, 'alpha'],
			[sage, 'beta'],
		] as const) {
			const r = await pilote.lancer({ profil: 'travail', dossier });
			if (!('session' in r) || 'manuel' in r) throw new Error('lancement attendu');
			const pid = (await etat.lire(r.session.id))!.pid!;
			pids.add(pid);
			let sortie = '';
			const a = pilote.abonner(r.session.id, (d) => {
				sortie += d;
			})!;
			sortie = a.relecture + sortie;
			const fin = Date.now() + 10_000;
			while (!/prêt/u.test(sortie) && Date.now() < fin) await new Promise((r2) => setTimeout(r2, 20));
			const enfant = Number(/enfant (\d+)\s/u.exec(sortie)?.[1]);
			expect(enfant, sortie).toBeGreaterThan(0);
			pids.add(enfant);
			sessions.push({ id: r.session.id, pid, enfant });
		}
		// les hooks du plugin assemblé ont tourné (exec, sans shell) avec la session Mnemo
		const evenements = await lireJournal(journal);
		expect(evenements.filter((e) => e.argv[1] === 'debut').map((e) => e.session).sort()).toEqual(sessions.map((s) => s.id).sort());

		await Promise.all([tetu.arreterTout(), sage.arreterTout()]);
		for (const s of sessions) {
			aucunSurvivant(s.pid, s.enfant);
			expect(await etat.lire(s.id)).toMatchObject({ pid: null, arretAttendu: 'service' });
		}
	}, 20_000);

	it('pause d’une session têtue avec un enfant têtu : plus aucun survivant, session en pause', async () => {
		const racine = await dossierTemporaire();
		await mkdir(join(racine, 'alpha'));
		await pluginDeTest(racine);
		const etat = ouvrirEtat(join(racine, 'etat.sqlite'));
		etats.push(etat);
		const pilote = creerPilote(fauxPorts(), {
			etat,
			terminaux,
			depot: DEPOT_ABSENT,
			plugin: {
				ecrire: (session, fichiers) => ecrirePlugin(racine, session, fichiers),
				retirer: async () => {},
				appel: { node: process.execPath, main: join(racine, 'journal.mjs'), version: '0.0.0-essai' },
				racine,
			},
			moteurs: moteursDeTest({ commande: process.execPath, avant: [FAUX_CLAUDE, '--tetu', '--enfant'] }),
			hote: { env: process.env, plateforme: process.platform, dossier: async (r) => ({ absolu: join(racine, r), reel: r }), processus: etatProcessus, demarrageMachineMs, nettoyerRestes },
		});
		pilotes.push(pilote);
		const r = await pilote.lancer({ profil: 'travail', dossier: 'alpha' });
		if (!('session' in r) || 'manuel' in r) throw new Error('lancement attendu');
		const pid = (await etat.lire(r.session.id))!.pid!;
		pids.add(pid);
		let sortie = '';
		const a = pilote.abonner(r.session.id, (d) => {
			sortie += d;
		})!;
		sortie = a.relecture + sortie;
		const fin = Date.now() + 10_000;
		while (!/prêt/u.test(sortie) && Date.now() < fin) await new Promise((r2) => setTimeout(r2, 20));
		const enfant = Number(/enfant (\d+)\s/u.exec(sortie)?.[1]);
		pids.add(enfant);
		expect(vivant(enfant)).toBe(true);
		const apres = await pilote.pause(r.session.id);
		expect(apres).toMatchObject({ etat: 'en_pause', arretAttendu: 'pause', pid: null });
		expect(pilote.enCours(r.session.id)).toBe(false);
		aucunSurvivant(pid, enfant);
	}, 20_000);

	it.skipIf(!POSIX)('plantage du service : les restes du groupe de l’ancienne session sont tués avant sa relance', async () => {
		const racine = await dossierTemporaire();
		await mkdir(join(racine, 'alpha'));
		await mkdir(join(racine, '_mnemo'));
		await pluginDeTest(racine);
		const hook = join(racine, 'journal.mjs');
		const service = spawn(process.execPath, [SERVICE, racine, FAUX_CLAUDE, hook], { stdio: ['ignore', 'pipe', 'inherit'] });
		pids.add(service.pid!);
		const ligne = await new Promise<string>((resoudre, rejeter) => {
			let lu = '';
			const minuteur = setTimeout(() => rejeter(new Error(`service muet : ${lu}`)), 20_000);
			service.stdout!.on('data', (m: Buffer) => {
				lu += m.toString('utf8');
				const fin = lu.indexOf('\n');
				if (fin !== -1) {
					clearTimeout(minuteur);
					resoudre(lu.slice(0, fin));
				}
			});
		});
		const ancien = JSON.parse(ligne) as { session: string; pid: number; enfant: number };
		pids.add(ancien.pid);
		pids.add(ancien.enfant);
		// plantage : le service meurt sans rien arrêter
		const mort = new Promise((r) => service.once('exit', r));
		service.kill('SIGKILL');
		await mort;
		// le chef de groupe meurt du SIGHUP de son pty, mais l'enfant qui l'ignore survit dans le groupe
		const fin = Date.now() + 5000;
		while (vivant(ancien.pid) && Date.now() < fin) await new Promise((r) => setTimeout(r, 20));
		expect(vivant(ancien.pid)).toBe(false);
		expect(vivant(ancien.enfant)).toBe(true);
		expect(groupe(ancien.pid)).toEqual([ancien.enfant]);

		const pil = await pilotageReel(racine, { terminaux });
		etats.push(pil.etat);
		commandeClaude(pil, { commande: process.execPath, avant: [FAUX_CLAUDE] });
		pil.plugin.appel = { node: process.execPath, main: hook, version: '0.0.0-essai' };
		const dep = dependancesReelles(racine);
		const pilote = creerPilote(dep, pil);
		pilotes.push(pilote);
		try {
			expect(await pilote.reprendreAuDemarrage()).toEqual([ancien.session]);
			const nouvelle = await pil.etat.lire(ancien.session);
			pids.add(nouvelle!.pid!);
			expect(nouvelle).toMatchObject({ etat: 'attend' });
			expect(nouvelle!.pid).not.toBe(ancien.pid);
			aucunSurvivant(ancien.pid, ancien.enfant);
		} finally {
			dep.index.fermer();
		}
	}, 40_000);

	it('pilotageReel : état paresseux, terminaux, appel de mnemo hook, claude depuis MNEMO_CLAUDE', async () => {
		const racine = await dossierTemporaire();
		await mkdir(join(racine, 'projet'));
		const pil = await pilotageReel(racine, { env: { MNEMO_CLAUDE: FAUX_CLAUDE, PATH: '' }, terminaux });
		expect(pil.plugin.racine).toBe(racine);
		expect(pil.plugin.appel).toEqual({ node: process.execPath, main: resolve(import.meta.dirname, '../../src/adaptateurs/cli/main.ts'), version: versionMnemo() });
		expect(pil.moteurs['claude-code']?.commande).toEqual({ commande: process.execPath, avant: [FAUX_CLAUDE] });
		expect(pil.terminaux).toBe(terminaux);
		await symlink(join(racine, 'projet'), join(racine, 'lien'));
		await mkdir(join(racine, '_mnemo', 'fiches'), { recursive: true });
		await symlink(join(racine, '_mnemo', 'fiches'), join(racine, 'vers-mnemo'));
		await symlink(tmpdir(), join(racine, 'dehors'));
		expect(await pil.hote.dossier('projet')).toEqual({ absolu: join(racine, 'projet'), reel: 'projet' });
		expect(await pil.hote.dossier('lien')).toEqual({ absolu: join(racine, 'lien'), reel: 'projet' });
		expect(await pil.hote.dossier('vers-mnemo')).toEqual({ absolu: join(racine, 'vers-mnemo'), reel: '_mnemo/fiches' });
		expect(await pil.hote.dossier('dehors')).toBeNull();
		expect(await pil.hote.dossier('absent')).toBeNull();
		expect(await pil.hote.dossier('../')).toBeNull();
		expect(await pil.hote.processus(process.pid, 'x')).toBe('autre');
		expect(await pil.etat.lister()).toEqual([]);
		pil.etat.fermer();
	});
});
