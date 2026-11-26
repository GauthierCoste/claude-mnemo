/**
 * Le suivi du service contre le vrai service lancé par la CLI (`mnemo init`, puis `mnemo ouvrir` lancé par l'app), comme le
 * test de bout en bout de l'interface : faux `claude`, `HOME` temporaire, `MNEMO_PORT=0`, aucun modèle, aucun navigateur.
 * Les étapes se suivent et partagent le même dossier Mnemo : démarrage par `ouvrir`, réception des sessions, rattachement,
 * chute et relance, arrêt sans relance. Aucun processus laissé derrière (`tuerLesRestes`).
 */
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ROUTES, type ReponseLancement } from '@mnemo/contrat';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Configuration } from '../../src/domaine/configuration.ts';
import { accesReel, type AccesService } from '../../src/infra/acces-service.ts';
import { cheminServiceJson, lireServiceJson, processusVivant, type ServiceLocal } from '../../src/infra/service-local.ts';
import { creerSuivi, type SuiviService } from '../../src/infra/suivi-service.ts';

const MAIN = resolve(import.meta.dirname, '../../../mnemo/src/adaptateurs/cli/main.ts');
const FAUX_CLAUDE = resolve(import.meta.dirname, '../../../mnemo/tests/aides/faux-claude.mjs');
const SONDAGE_MS = 200;
const DELAI = 120_000;

let dossier = '';
let home = '';
let configuration: Configuration;
let environnement: NodeJS.ProcessEnv;
const suivis: SuiviService[] = [];
let principal: SuiviService;
const vies: string[] = [];
let demarrages = 0;
let sessionLancee = '';

async function jusqua(condition: () => boolean, delaiMs = 60_000): Promise<boolean> {
	const fin = Date.now() + delaiMs;
	while (Date.now() < fin) {
		if (condition()) return true;
		await new Promise((r) => setTimeout(r, 20));
	}
	return condition();
}

/** Processus dont la ligne de commande nomme `texte` (POSIX, d'après `ps`), hormis celui-ci. */
function processusAvec(texte: string): number[] {
	if (process.platform === 'win32') return [];
	return execFileSync('ps', ['-A', '-ww', '-o', 'pid=,command='], { encoding: 'utf8' })
		.split('\n')
		.map((l) => /^\s*(\d+)\s+(.*)$/u.exec(l))
		.filter((m): m is RegExpExecArray => m !== null && m[2]!.includes(texte) && Number(m[1]) !== process.pid)
		.map((m) => Number(m[1]));
}

/** Tue (SIGKILL) tout processus resté vivant dont la ligne de commande nomme `dossier` (service, faux `claude`, hooks). */
function tuerLesRestes(texte: string): void {
	for (const pid of processusAvec(texte)) {
		try {
			process.kill(pid, 'SIGKILL');
		} catch {
			// déjà mort
		}
	}
}

/** Accès réel au service du test, qui compte les démarrages. */
function acces(): AccesService {
	const reel = accesReel(configuration, { environnement, delaisReconnexionMs: [100, 200] });
	return {
		...reel,
		demarrer: () => {
			demarrages++;
			return reel.demarrer();
		},
	};
}

function suivre(): SuiviService {
	const s = creerSuivi({ acces: acces(), fenetreAuFocus: () => false, intervalleSondageMs: SONDAGE_MS });
	suivis.push(s);
	return s;
}

/** `POST <chemin>` au service (jeton, sans Origin) ; rend le statut et le corps JSON. */
function poster<T>(s: ServiceLocal, chemin: string, corps: unknown): Promise<{ statut: number; corps: T }> {
	return new Promise((resoudre, rejeter) => {
		const donnees = JSON.stringify(corps);
		const req = request(
			{ host: '127.0.0.1', port: s.port, method: 'POST', path: chemin, headers: { Authorization: `Bearer ${s.jeton}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(donnees) } },
			(res) => {
				let texte = '';
				res.on('data', (m: Buffer) => (texte += m.toString('utf8')));
				res.on('end', () => resoudre({ statut: res.statusCode ?? 0, corps: JSON.parse(texte) as T }));
			},
		);
		req.on('error', rejeter);
		req.end(donnees);
	});
}

beforeAll(async () => {
	dossier = realpathSync(mkdtempSync(join(tmpdir(), 'mnemo-app-service-')));
	home = realpathSync(mkdtempSync(join(tmpdir(), 'mnemo-app-service-home-')));
	const modeles = join(home, 'modeles-vide');
	mkdirSync(modeles);
	mkdirSync(join(dossier, 'alpha'));
	environnement = { ...process.env, HOME: home, MNEMO_CLAUDE: FAUX_CLAUDE, MNEMO_SANS_MCP: '1', MNEMO_MODELES: modeles, MNEMO_SANS_NAVIGATEUR: '1' };
	await new Promise<void>((resoudre, rejeter) =>
		execFile(process.execPath, [MAIN, 'init', '--oui'], { cwd: dossier, env: environnement, timeout: 60_000 }, (erreur, sortie, erreurs) =>
			erreur ? rejeter(new Error(`mnemo init : ${erreur.message}\n${sortie}${erreurs}`)) : resoudre(),
		),
	);
	configuration = { racine: dossier, node: process.execPath, main: MAIN, path: process.env['PATH'] ?? '/usr/bin:/bin', port: 0 };
}, DELAI);

afterAll(async () => {
	for (const s of suivis) s.fermer();
	const reste = dossier === '' ? null : lireServiceJson(dossier);
	if (reste !== null && processusVivant(reste.pid)) {
		process.kill(reste.pid, 'SIGTERM');
		await jusqua(() => !processusVivant(reste.pid), 30_000);
	}
	if (dossier !== '') tuerLesRestes(dossier);
	for (const d of [dossier, home]) if (d !== '') rmSync(d, { recursive: true, force: true, maxRetries: 3 });
}, DELAI);

describe('suivi contre le vrai service', () => {
	it('aucun service : démarrage par `ouvrir` (détaché), service.json relu, liste des sessions reçue par le WebSocket', async () => {
		principal = suivre();
		principal.surChangement((i) => {
			if (vies.at(-1) !== i.vie.etat) vies.push(i.vie.etat);
		});
		await principal.ouvrir();
		const i = principal.instantane();
		expect(i.vie.etat, i.vie.raison ?? '').toBe('vivant');
		expect(vies).toEqual(['demarrage', 'vivant']);
		expect(demarrages).toBe(1);
		expect(i.service).toEqual(lireServiceJson(dossier));
		expect(processusVivant(i.service!.pid)).toBe(true);
		expect(await jusqua(() => principal.instantane().sessions !== null)).toBe(true);
		expect(principal.instantane().sessions).toEqual([]);
	}, DELAI);

	it('une session lancée arrive par le WebSocket', async () => {
		const service = principal.instantane().service!;
		const r = await poster<ReponseLancement>(service, ROUTES.sessions, { profil: 'travail', dossier: 'alpha' });
		expect(r.statut).toBe(201);
		sessionLancee = r.corps.session.id;
		expect(await jusqua(() => principal.instantane().sessions?.some((s) => s.id === sessionLancee) ?? false)).toBe(true);
	}, DELAI);

	it('service vivant : rattachement, sans démarrage, avec la liste des sessions', async () => {
		const second = suivre();
		await second.ouvrir();
		expect(second.instantane()).toMatchObject({ vie: { etat: 'vivant' }, service: principal.instantane().service });
		expect(demarrages).toBe(1);
		expect(await jusqua(() => second.instantane().sessions?.some((s) => s.id === sessionLancee) ?? false)).toBe(true);
		// l'app n'a qu'une instance : ce second suivi s'arrête ici (il relancerait lui aussi le service tombé)
		second.fermer();
	}, DELAI);

	it('service tué (service.json resté) : une relance automatique par `ouvrir`', async () => {
		const avant = principal.instantane().service!;
		process.kill(avant.pid, 'SIGKILL');
		expect(await jusqua(() => principal.instantane().vie.etat === 'vivant' && principal.instantane().service?.pid !== avant.pid)).toBe(true);
		expect(vies).toEqual(['demarrage', 'vivant', 'demarrage', 'vivant']);
		expect(demarrages).toBe(2);
		expect(principal.instantane().service).toEqual(lireServiceJson(dossier));
		expect(await jusqua(() => principal.instantane().sessions !== null)).toBe(true);
	}, DELAI);

	it('arrêt (`POST /api/arret`) : arrêté à la mort du processus, et pas de relance ensuite', async () => {
		const service = principal.instantane().service!;
		const arret = principal.arreter();
		expect(principal.instantane().vie.etat).toBe('arret');
		expect(await arret).toEqual({ ok: true });
		expect(processusVivant(service.pid)).toBe(false);
		expect(principal.instantane()).toMatchObject({ vie: { etat: 'arrete' }, sessions: null, service: null });
		await new Promise((r) => setTimeout(r, SONDAGE_MS * 8));
		expect(principal.instantane().vie.etat).toBe('arrete');
		expect(vies.slice(-2)).toEqual(['arret', 'arrete']);
		expect(demarrages).toBe(2);
		expect(existsSync(cheminServiceJson(dossier))).toBe(false);
		expect(processusAvec(join(dossier, ''))).toEqual([]);
	}, DELAI);
});
