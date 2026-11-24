import { execFile, execFileSync } from 'node:child_process';
import { uptime } from 'node:os';
import type { Session } from '../domaine/session.ts';

/** Entre SIGTERM et SIGKILL. */
export const DELAI_TUE_MS = 3000;
/** Après SIGKILL : au-delà, l'arrêt rend la main quoi qu'il arrive. */
export const ATTENTE_FINALE_MS = 5000;
/** Intervalle entre deux sondes d'une attente. */
export const SONDE_MS = 50;
/** Outil de liste des processus qui ne répond pas à temps : rien n'est conclu. */
const DELAI_SONDE_MS = 2000;
/** Écart toléré entre deux mesures du démarrage de la machine. */
const TOLERANCE_DEMARRAGE_MS = 5000;
/** `lstart` est à la seconde (tronqué) : marge de chaque côté de la fenêtre de vie de la session. */
const MARGE_FENETRE_MS = 1000;

/** Signal 0 à un pid (ou à un groupe : `-pgid`) ; `interdit` (EPERM) : il existe, sous un autre utilisateur. */
export function existenceProcessus(cible: number): 'oui' | 'non' | 'interdit' {
	try {
		process.kill(cible, 0);
		return 'oui';
	} catch (erreur) {
		return (erreur as NodeJS.ErrnoException).code === 'EPERM' ? 'interdit' : 'non';
	}
}

/** Environnement d'un outil du système, en locale C : dates et noms lisibles. */
const environnementC = (): NodeJS.ProcessEnv => ({ ...process.env, LC_ALL: 'C', LANG: 'C' });

/** Sortie d'un outil du système qui décrit les processus (`ps`, `tasklist`), sans shell, en locale C pour des dates et des noms lisibles ; null en cas d'échec ou de délai. */
export function sonderProcessus(commande: string, args: string[]): Promise<string | null> {
	return new Promise((resoudre) => {
		execFile(commande, args, { encoding: 'utf8', timeout: DELAI_SONDE_MS, env: environnementC(), windowsHide: true }, (erreur, sortie) => {
			resoudre(erreur === null ? sortie : null);
		});
	});
}

const ps = (args: string[]): Promise<string | null> => sonderProcessus('ps', args);

/**
 * Windows : nom de l'image du processus `pid` (`node.exe`…), lu par `tasklist` ; `''` s'il n'existe pas (tasklist répond
 * alors par une ligne d'information, traduite, sans champ CSV) ; null si tasklist échoue.
 */
export async function imageProcessusWindows(pid: number, sonder: typeof sonderProcessus = sonderProcessus): Promise<string | null> {
	if (!Number.isInteger(pid) || pid <= 0) return '';
	const sortie = await sonder('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
	if (sortie === null) return null;
	for (const ligne of sortie.split(/\r?\n/u)) {
		const champs = /^"([^"]*)","(\d+)"/u.exec(ligne.trim());
		if (champs !== null && Number(champs[2]) === pid) return champs[1]!;
	}
	return '';
}

/** Démarrage de la machine (ms depuis l'époque, à la seconde). */
export function demarrageMachineMs(): number {
	return Math.round((Date.now() - uptime() * 1000) / 1000) * 1000;
}

/**
 * Un pid enregistré pour la session `session` : `mort` ; `session` (vivant, et sa ligne de commande contient l'uuid de la
 * session : Mnemo la lance avec `--session-id`/`--resume <uuid>`) ; `autre` (vivant mais pas à nous : autre ligne de commande,
 * pas le droit de le voir, `ps` muet, ou Windows, où rien ne le vérifie à peu de frais).
 */
export async function etatProcessus(pid: number, session: string, plateforme: NodeJS.Platform = process.platform): Promise<'mort' | 'session' | 'autre'> {
	if (!Number.isInteger(pid) || pid <= 1) return 'mort';
	const e = existenceProcessus(pid);
	if (e === 'non') return 'mort';
	if (e === 'interdit' || plateforme === 'win32') return 'autre';
	const ligne = await ps(['-o', 'command=', '-p', String(pid)]);
	if (ligne === null) return existenceProcessus(pid) === 'non' ? 'mort' : 'autre';
	return session !== '' && ligne.includes(session) ? 'session' : 'autre';
}

/** Instant de démarrage (à la seconde, tronqué) et ligne de commande d'un processus (`ps`) ; null : mort, `ps` muet, Windows. */
export async function identiteProcessus(pid: number, plateforme: NodeJS.Platform = process.platform): Promise<{ debutMs: number; commande: string } | null> {
	if (!Number.isInteger(pid) || pid <= 0 || plateforme === 'win32') return null;
	const sortie = await ps(['-o', 'lstart=', '-o', 'command=', '-p', String(pid)]);
	if (sortie === null) return null;
	const debutMs = lireLstart(sortie);
	const annee = /\s\d{1,2}:\d{2}:\d{2}\s+\d{4}/u.exec(sortie);
	if (debutMs === null || annee === null) return null;
	return { debutMs, commande: sortie.slice(annee.index + annee[0].length).trim() };
}

/** Deux mesures du démarrage de la machine désignent-elles le même démarrage ? */
export function memeDemarrage(a: number, b: number): boolean {
	return Math.abs(a - b) <= TOLERANCE_DEMARRAGE_MS;
}

const MOIS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** `lstart` de `ps` en locale C (« Sun Nov 22 13:09:01 2026 », ou jour avant mois), en heure locale ; null si illisible. */
export function lireLstart(texte: string): number | null {
	const m =
		/(?:^|\s)([A-Za-z]{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(\d{4})/u.exec(texte) ??
		/(?:^|\s)(\d{1,2})\s+([A-Za-z]{3})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(\d{4})/u.exec(texte);
	if (m === null) return null;
	const [moisTexte, jour] = /^\d/u.test(m[1]!) ? [m[2]!, m[1]!] : [m[1]!, m[2]!];
	const mois = MOIS[moisTexte.toLowerCase()];
	if (mois === undefined) return null;
	return new Date(Number(m[6]), mois, Number(jour), Number(m[3]), Number(m[4]), Number(m[5])).getTime();
}

/** Membres du groupe `pgid` avec leur instant de démarrage (POSIX) ; null si `ps` échoue. */
export async function membresDuGroupe(pgid: number): Promise<{ pid: number; debutMs: number }[] | null> {
	const sortie = await ps(['-A', '-o', 'pid=,pgid=,lstart=']);
	if (sortie === null) return null;
	const membres: { pid: number; debutMs: number }[] = [];
	for (const ligne of sortie.split('\n')) {
		const m = /^\s*(\d+)\s+(\d+)\s+(.+)$/u.exec(ligne);
		if (m === null || Number(m[2]) !== pgid) continue;
		const debutMs = lireLstart(m[3]!);
		if (debutMs !== null) membres.push({ pid: Number(m[1]), debutMs });
	}
	return membres;
}

/** Attend que `condition` soit vraie, `maxMs` au plus ; rend sa dernière valeur. */
export async function jusqua(condition: () => boolean, maxMs: number): Promise<boolean> {
	const fin = Date.now() + maxMs;
	while (!condition()) {
		const reste = fin - Date.now();
		if (reste <= 0) return condition();
		await new Promise((r) => setTimeout(r, Math.min(SONDE_MS, reste)));
	}
	return true;
}

/** Le processus courant et le chef de son groupe (null : inconnu, ou Windows). */
export type Soi = { pid: number; groupe: number | null };

let groupeCourant: number | null | undefined;

/** Lu une fois par `ps`, de façon synchrone : `signalerGroupe` sert aussi dans le gestionnaire `exit`. */
export function soiMeme(): Soi {
	if (groupeCourant === undefined) {
		groupeCourant = null;
		if (process.platform !== 'win32') {
			try {
				const lu = Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8', timeout: DELAI_SONDE_MS, env: environnementC(), stdio: ['ignore', 'pipe', 'ignore'] }).trim());
				if (Number.isInteger(lu) && lu > 0) groupeCourant = lu;
			} catch {
				// groupe inconnu : aucun signal de groupe
			}
		}
	}
	return { pid: process.pid, groupe: groupeCourant };
}

/** Pid qu'aucun signal ne vise : non entier, 0 (son propre groupe), 1 (`-1` : tous les processus de l'utilisateur), soi-même, le chef de son groupe. */
export function pidInterdit(pid: number, soi: Soi): boolean {
	return !Number.isInteger(pid) || pid <= 1 || pid === soi.pid || pid === soi.groupe;
}

/** Cibles de `signalerGroupe` : le groupe `-pid` puis le pid (POSIX, groupe propre connu), sinon le pid seul ; aucune pour un pid interdit. */
export function ciblesDuSignal(pid: number, plateforme: NodeJS.Platform, soi: Soi): number[] {
	if (pidInterdit(pid, soi)) return [];
	return plateforme === 'win32' || soi.groupe === null ? [pid] : [-pid, pid];
}

/**
 * Signal au groupe `-pid` puis au pid lui-même (sorti de son groupe). Sous Windows, pas de groupe ni de signal doux (tout
 * signal y termine net) : `taskkill /T /F` arrête le pid et ses descendants (serveur MCP, shells des outils).
 */
export function signalerGroupe(pid: number, signal: NodeJS.Signals, plateforme: NodeJS.Platform): void {
	if (plateforme === 'win32') {
		if (pidInterdit(pid, soiMeme())) return;
		try {
			execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: DELAI_SONDE_MS, windowsHide: true, stdio: 'ignore' });
		} catch {
			// déjà mort, ou taskkill refusé : le pid seul
			try {
				process.kill(pid, signal);
			} catch {
				// déjà mort
			}
		}
		return;
	}
	for (const cible of ciblesDuSignal(pid, plateforme, soiMeme())) {
		try {
			process.kill(cible, signal);
		} catch {
			// déjà mort, ou plus de groupe
		}
	}
}

export type ReglagesRestes = { plateforme?: NodeJS.Platform; demarrage?: () => number };

/**
 * Restes prouvés d'une session après un plantage du service. Rien n'est fait sauf si : POSIX ; trace complète (pid,
 * démarrage de la machine, lancement, dernier battement) ; chef mort mais groupe `-pid` vivant ; même démarrage de la
 * machine (à 5 s près). Alors seuls les membres du groupe nés entre `lanceMs − 1 s` et `vuVivantMs + 1 s` sont signalés,
 * un par un (jamais `-pid`) : SIGTERM, puis SIGKILL 3 s plus tard. Si le pid a été réattribué à un nouveau chef de groupe
 * mort depuis, c'était après que notre groupe s'est vidé, donc après notre dernier battement : ses membres sont nés plus tard.
 */
export async function nettoyerRestes(s: Pick<Session, 'pid' | 'demarrageMachineMs' | 'lanceMs' | 'vuVivantMs'>, reglages: ReglagesRestes = {}): Promise<void> {
	const plateforme = reglages.plateforme ?? process.platform;
	const { pid, demarrageMachineMs: demarrage, lanceMs, vuVivantMs } = s;
	const soi = soiMeme();
	if (plateforme === 'win32' || pid === null || pidInterdit(pid, soi)) return;
	if (demarrage == null || lanceMs == null || vuVivantMs == null) return;
	if (existenceProcessus(pid) !== 'non' || existenceProcessus(-pid) === 'non') return;
	if (Math.abs((reglages.demarrage ?? demarrageMachineMs)() - demarrage) > TOLERANCE_DEMARRAGE_MS) return;
	const membres = await membresDuGroupe(pid);
	if (membres === null) return;
	const cibles = membres.filter((m) => !pidInterdit(m.pid, soi) && m.debutMs >= lanceMs - MARGE_FENETRE_MS && m.debutMs <= vuVivantMs + MARGE_FENETRE_MS).map((m) => m.pid);
	if (cibles.length === 0) return;
	const signaler = (signal: NodeJS.Signals) => {
		for (const cible of cibles) {
			try {
				process.kill(cible, signal);
			} catch {
				// déjà mort
			}
		}
	};
	const morts = () => cibles.every((c) => existenceProcessus(c) === 'non');
	signaler('SIGTERM');
	if (await jusqua(morts, DELAI_TUE_MS)) return;
	signaler('SIGKILL');
	await jusqua(morts, ATTENTE_FINALE_MS);
}
