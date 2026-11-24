import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ROUTES } from '@mnemo/contrat';
import type { SessionVue } from '@mnemo/contrat';
import { initialiser } from '../../src/application/initialiser.ts';
import type { Session } from '../../src/domaine/session.ts';
import { ouvrirEtat } from '../../src/infra/etat-sqlite.ts';
import { dependancesReelles } from '../../src/infra/systeme.ts';
import { terminauxPty } from '../../src/infra/terminaux-pty.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { git } from '../aides/git.ts';
import { appeler, jusqua } from '../aides/service-faux.ts';

const MAIN = resolve(import.meta.dirname, '../../src/adaptateurs/cli/main.ts');
const FAUX_CLAUDE = resolve(import.meta.dirname, '../aides/faux-claude.mjs');
const POSIX = process.platform !== 'win32';

const terminaux = await terminauxPty();
// un service enfant sous un vrai pseudo-terminal : sauté sans node-pty en local, exigé en CI
const sauter = !terminaux.disponibles().ok && process.env.CI === undefined;

/** Services lancés (processus enfants) et dossiers Mnemo : tout ce qui y tourne encore est tué en fin de test. */
const enfants: ChildProcess[] = [];
const racines: string[] = [];

/** Processus dont la ligne de commande contient `texte` (POSIX, d'après `ps`). */
function processusAvec(texte: string): { pid: number; commande: string }[] {
	const sortie = execFileSync('ps', ['-A', '-ww', '-o', 'pid=,command='], { encoding: 'utf8' });
	return sortie
		.split('\n')
		.map((l) => /^\s*(\d+)\s+(.*)$/u.exec(l))
		.filter((m): m is RegExpExecArray => m !== null && m[2]!.includes(texte))
		.map((m) => ({ pid: Number(m[1]), commande: m[2]! }));
}

function tuer(pid: number): void {
	try {
		process.kill(pid, 'SIGKILL');
	} catch {
		// déjà mort
	}
}

afterEach(async () => {
	for (const e of enfants.splice(0)) if (e.exitCode === null && e.signalCode === null && e.pid !== undefined) tuer(e.pid);
	for (const racine of racines.splice(0)) for (const p of processusAvec(racine)) tuer(p.pid);
});

/** Dossier Mnemo réel (mémoire git initialisée) avec un dossier de projet `alpha/`. */
async function dossierMnemo(): Promise<string> {
	const racine = await dossierTemporaire();
	racines.push(racine);
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

type Lance = { enfant: ChildProcess; racine: string; sortie: () => string; fin: Promise<number | null> };

/** `mnemo <racine>` dans un processus enfant : HOME temporaire, faux claude, jamais de navigateur. */
function mnemo(racine: string, home: string): Lance {
	const enfant = spawn(process.execPath, [MAIN, racine], {
		// jamais le dossier courant de vitest (il peut être sous une vraie mémoire) : la racine est donnée en argument
		cwd: home,
		env: { ...process.env, HOME: home, MNEMO_CLAUDE: FAUX_CLAUDE, MNEMO_SANS_NAVIGATEUR: '1', MNEMO_SANS_MCP: '1' },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	enfants.push(enfant);
	let texte = '';
	enfant.stdout!.on('data', (m: Buffer) => {
		texte += m.toString('utf8');
	});
	enfant.stderr!.on('data', (m: Buffer) => {
		texte += m.toString('utf8');
	});
	const fin = new Promise<number | null>((r) => enfant.once('exit', (code) => r(code)));
	return { enfant, racine, sortie: () => texte, fin };
}

/** Adresse affichée par le service ; le jeton (jamais affiché hors d'un terminal) est lu dans `.mnemo/jeton`. */
async function adresse(l: Lance): Promise<{ port: number; jeton: string }> {
	const re = /Mnemo : http:\/\/127\.0\.0\.1:(\d+)\//u;
	expect(await jusqua(() => re.test(l.sortie()), 30_000), l.sortie()).toBe(true);
	const m = re.exec(l.sortie())!;
	return { port: Number(m[1]), jeton: (await readFile(join(l.racine, '.mnemo', 'jeton'), 'utf8')).trim() };
}

function lireEtat(racine: string): (id: string) => Promise<Session | null> {
	return async (id) => {
		const etat = ouvrirEtat(join(racine, '.mnemo', 'etat.sqlite'));
		try {
			return await etat.lire(id);
		} finally {
			etat.fermer();
		}
	};
}

const fauxClaudesDe = (id: string) => processusAvec(id).filter((p) => p.commande.includes('faux-claude.mjs'));
const journalMemoire = (racine: string) => git(join(racine, '_mnemo'), 'log', '--format=%B');

describe.skipIf(sauter || !POSIX)('redémarrage du service (processus enfant, faux-claude)', () => {
	it('SIGTERM : états gardés, aucun épisode, service.json retiré ; le suivant reprend par --resume, un processus par session ; un second mnemo réutilise le premier ; SIGKILL : a_relire (épisode minimal), relancées', async () => {
		const racine = await dossierMnemo();
		const home = await dossierTemporaire();
		const lire = lireEtat(racine);

		// --- premier service : deux sessions lancées
		const s1 = mnemo(racine, home);
		const a1 = await adresse(s1);
		const ids: string[] = [];
		for (let i = 0; i < 2; i++) {
			const r = await appeler(a1.port, 'POST', ROUTES.sessions, { jeton: a1.jeton, corps: { profil: 'travail', dossier: 'alpha' } });
			expect(r.statut, r.texte).toBe(201);
			ids.push((r.corps as { session: SessionVue }).session.id);
		}
		// le hook `debut` (par le service) est passé : l'état a bougé depuis la création
		for (const id of ids) expect(await jusqua(async () => ((s) => s !== null && s.majMs > s.creeeMs && s.pid !== null)(await lire(id)), 30_000)).toBe(true);
		const avant = await Promise.all(ids.map(lire));
		const pidsAvant = avant.map((s) => s!.pid!);
		const journalAvant = journalMemoire(racine);

		// --- SIGTERM : arrêt propre
		s1.enfant.kill('SIGTERM');
		expect(await Promise.race([s1.fin, new Promise((r) => setTimeout(() => r('délai'), 30_000))])).toBe(0);
		expect(existsSync(join(racine, '.mnemo', 'service.json'))).toBe(false);
		for (const [i, id] of ids.entries()) {
			const s = await lire(id);
			expect(s).toMatchObject({ etat: avant[i]!.etat, pid: null, arretAttendu: 'service' });
			expect(fauxClaudesDe(id)).toEqual([]);
		}
		for (const pid of pidsAvant) expect(processusAvec(String(pid)).filter((p) => p.pid === pid)).toEqual([]);
		expect(journalMemoire(racine)).toBe(journalAvant);
		expect(journalMemoire(racine)).not.toMatch(/mnemo: episode/u);

		// --- deuxième service : chaque session reprise par --resume, un seul claude par session
		const s2 = mnemo(racine, home);
		const a2 = await adresse(s2);
		for (const id of ids) {
			expect(await jusqua(() => fauxClaudesDe(id).length === 1, 30_000), JSON.stringify(fauxClaudesDe(id))).toBe(true);
			expect(fauxClaudesDe(id)[0]!.commande).toContain(`--resume ${id}`);
		}

		// --- un second `mnemo` réutilise le service vivant : affiche son adresse et sort
		const s3 = mnemo(racine, home);
		expect(await Promise.race([s3.fin, new Promise((r) => setTimeout(() => r('délai'), 30_000))])).toBe(0);
		expect(s3.sortie()).toContain(`http://127.0.0.1:${a2.port}/`);
		expect(s3.sortie()).not.toContain(a2.jeton);
		for (const id of ids) expect(fauxClaudesDe(id)).toHaveLength(1);

		// --- SIGKILL : plantage du service ; ses sessions meurent avec leur terminal, sans `fin`
		const pidsS2 = await Promise.all(ids.map(async (id) => (await lire(id))!.pid!));
		s2.enfant.kill('SIGKILL');
		await s2.fin;
		expect(await jusqua(() => ids.every((id) => fauxClaudesDe(id).length === 0), 15_000)).toBe(true);
		for (const [i, id] of ids.entries()) expect(await lire(id)).toMatchObject({ pid: pidsS2[i] });
		// le service.json d'un service mort reste : le suivant ne s'y fie pas

		// --- troisième service : sessions passées à relire (épisode minimal), puis relancées
		const s4 = mnemo(racine, home);
		await adresse(s4);
		for (const id of ids) expect(await jusqua(() => fauxClaudesDe(id).length === 1, 30_000)).toBe(true);
		const journal = journalMemoire(racine);
		expect(journal.match(/mnemo: episode/gu)).toHaveLength(2);
		const episodes = await Promise.all(
			(await readdir(join(racine, '_mnemo', 'episodes'), { recursive: true }))
				.filter((f) => f.endsWith('.md'))
				.map((f) => readFile(join(racine, '_mnemo', 'episodes', f), 'utf8')),
		);
		for (const id of ids) expect(episodes.filter((t) => t.includes(id) && t.includes('minimal: true'))).toHaveLength(1);

		s4.enfant.kill('SIGTERM');
		expect(await Promise.race([s4.fin, new Promise((r) => setTimeout(() => r('délai'), 30_000))])).toBe(0);
		for (const id of ids) expect(fauxClaudesDe(id)).toEqual([]);
	}, 240_000);
	it('SIGHUP (terminal fermé) : arrêt propre comme SIGTERM — code 0, ni service.json ni verrou, aucun épisode, aucun processus de session', async () => {
		const racine = await dossierMnemo();
		const home = await dossierTemporaire();
		const lire = lireEtat(racine);
		const s1 = mnemo(racine, home);
		const a1 = await adresse(s1);
		const r = await appeler(a1.port, 'POST', ROUTES.sessions, { jeton: a1.jeton, corps: { profil: 'travail', dossier: 'alpha' } });
		expect(r.statut, r.texte).toBe(201);
		const id = (r.corps as { session: SessionVue }).session.id;
		expect(await jusqua(async () => ((s) => s !== null && s.majMs > s.creeeMs && s.pid !== null)(await lire(id)), 30_000)).toBe(true);
		const avant = await lire(id);
		const journalAvant = journalMemoire(racine);
		// stdout/stderr fermés côté lecteur, comme un terminal qui disparaît : aucune écriture ne doit faire planter l'arrêt
		s1.enfant.stdout!.destroy();
		s1.enfant.stderr!.destroy();
		s1.enfant.kill('SIGHUP');
		expect(await Promise.race([s1.fin, new Promise((r) => setTimeout(() => r('délai'), 30_000))])).toBe(0);
		expect(existsSync(join(racine, '.mnemo', 'service.json'))).toBe(false);
		expect(existsSync(join(racine, '.mnemo', 'service.verrou'))).toBe(false);
		expect(await lire(id)).toMatchObject({ etat: avant!.etat, pid: null, arretAttendu: 'service' });
		expect(fauxClaudesDe(id)).toEqual([]);
		expect(journalMemoire(racine)).toBe(journalAvant);
	}, 90_000);
});
