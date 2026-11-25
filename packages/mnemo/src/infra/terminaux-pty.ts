import { accessSync, chmodSync, constants, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { OptionsTerminal, Terminal, Terminaux } from '../application/ports.ts';
import { TOUCHES_CLAUDE_CODE } from '../domaine/moteurs/claude-code/touches.ts';
import type { TouchesDuMoteur } from '../domaine/moteurs/moteur.ts';
import { ATTENTE_FINALE_MS, DELAI_TUE_MS, existenceProcessus, jusqua, signalerGroupe } from './processus.ts';

/** Ce que Mnemo utilise de node-pty, typé ici : le paquet est facultatif (`optionalDependencies`). */
type ProcessusPty = {
	pid: number;
	write(d: string): void;
	resize(colonnes: number, lignes: number): void;
	kill(signal?: string): void;
	onData(f: (d: string) => void): { dispose(): void };
	onExit(f: (e: { exitCode: number; signal?: number }) => void): { dispose(): void };
};
type ModulePty = {
	spawn(fichier: string, args: string[], options: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> }): ProcessusPty;
};

/** Délai laissé à la commande d'arrêt du moteur (`/exit`) avant SIGTERM, par défaut. */
export const DELAI_ARRET_MS = 5000;
/** Entre la commande d'arrêt (`/exit`) et la touche Entrée : une seule écriture pourrait être lue comme un collage. */
const PAUSE_ENTREE_MS = 100;
/** Processus d'essai lancé au chargement : au-delà, node-pty est jugé inutilisable. */
const DELAI_ESSAI_MS = 5000;

/**
 * `delaiArretMs` : délai par défaut de `arreter` (tests : plus court). `charger` : remplace `import('node-pty')` (tests du
 * mode dégradé). `plateforme` : celle de l'arrêt (groupe de processus sous POSIX, `kill()` de node-pty sous Windows).
 */
export type ReglagesPty = { delaiArretMs?: number; charger?: () => Promise<unknown>; plateforme?: NodeJS.Platform };

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

/** Un processus du groupe `pgid` vit-il encore (zombie compris) ? */
function groupeVivant(pgid: number): boolean {
	return existenceProcessus(-pgid) !== 'non';
}

function terminalPty(proc: ProcessusPty, delaiParDefaut: number, plateforme: NodeJS.Platform, touches: TouchesDuMoteur): Terminal {
	const pid = proc.pid;
	let fin: { code: number | null } | null = null;
	const fins: ((code: number | null) => void)[] = [];
	proc.onExit(({ exitCode, signal }) => {
		if (fin !== null) return;
		fin = { code: signal !== undefined && signal !== 0 ? null : exitCode };
		for (const f of fins.splice(0)) {
			try {
				f(fin.code);
			} catch {
				// un abonné en panne n'empêche pas les autres
			}
		}
	});
	const fini = () => fin !== null;
	const ecrire = (d: string): void => {
		if (fin !== null) return;
		try {
			proc.write(d);
		} catch {
			// pty déjà fermé
		}
	};
	const tuerWindows = (): void => {
		try {
			proc.kill();
		} catch {
			// déjà mort
		}
	};

	let arret: Promise<void> | null = null;
	const arreter = async (delaiMs: number, echap: boolean): Promise<void> => {
		if (fin === null && echap) {
			// un dialogue de permission est peut-être ouvert : Échap le ferme (sinon la commande d'arrêt y serait tapée)
			ecrire(touches.echap);
			await pause(touches.pauseApresEchapMs);
		}
		if (fin === null) {
			// Claude Code : Ctrl-U efface ce que l'utilisateur avait commencé à taper, puis `/exit`
			ecrire(touches.arret);
			await pause(Math.min(PAUSE_ENTREE_MS, delaiMs));
			ecrire(touches.entree);
			await jusqua(fini, delaiMs - PAUSE_ENTREE_MS);
		}
		if (plateforme === 'win32') {
			if (fin === null) {
				tuerWindows();
				await jusqua(fini, DELAI_TUE_MS);
			}
			if (fin === null) {
				tuerWindows();
				await jusqua(fini, ATTENTE_FINALE_MS);
			}
			return;
		}
		// POSIX : rien ne doit survivre dans le groupe, même quand le processus est sorti de lui-même (enfants têtus)
		const vide = () => fin !== null && !groupeVivant(pid);
		if (!vide()) {
			signalerGroupe(pid, 'SIGTERM', plateforme);
			await jusqua(vide, DELAI_TUE_MS);
		}
		if (!vide()) {
			signalerGroupe(pid, 'SIGKILL', plateforme);
			await jusqua(vide, ATTENTE_FINALE_MS);
		}
	};

	return {
		pid,
		ecrire,
		redimensionner(colonnes, lignes) {
			if (fin !== null) return;
			try {
				proc.resize(colonnes, lignes);
			} catch {
				// pty déjà fermé
			}
		},
		surSortie(f) {
			const abonnement = proc.onData(f);
			return () => abonnement.dispose();
		},
		surFin(f) {
			if (fin !== null) f(fin.code);
			else fins.push(f);
		},
		arreter(delaiMs = delaiParDefaut, options = {}) {
			arret ??= arreter(Math.max(0, delaiMs), options.echap === true);
			return arret;
		},
	};
}

async function importerNodePty(): Promise<unknown> {
	const nom = 'node-pty';
	return import(nom);
}

/**
 * Certaines installations de node-pty (paquets précompilés, magasin pnpm) perdent le droit d'exécution de `spawn-helper`
 * (macOS) : tout lancement échoue alors (`posix_spawnp failed`). On le rend, au mieux.
 */
function reparerSpawnHelper(): void {
	if (process.platform === 'win32') return;
	let racine: string;
	try {
		racine = dirname(createRequire(import.meta.url).resolve('node-pty/package.json'));
	} catch {
		return;
	}
	for (const dossier of ['build/Release', 'build/Debug', `prebuilds/${process.platform}-${process.arch}`]) {
		const assistant = join(racine, ...dossier.split('/'), 'spawn-helper');
		if (!existsSync(assistant)) continue;
		try {
			accessSync(assistant, constants.X_OK);
		} catch {
			try {
				chmodSync(assistant, 0o755);
			} catch {
				// pas le droit : l'essai dira si node-pty fonctionne
			}
		}
	}
}

function moduleDe(m: unknown): ModulePty | null {
	const candidats = [m, (m as { default?: unknown } | null)?.default];
	for (const c of candidats) if (typeof (c as ModulePty | null)?.spawn === 'function') return c as ModulePty;
	return null;
}

/** Lance un processus d'essai (Node qui sort aussitôt) : rend null s'il finit, sinon le motif. */
async function essayer(mod: ModulePty): Promise<string | null> {
	let proc: ProcessusPty;
	try {
		proc = mod.spawn(process.execPath, ['-e', ''], { name: 'xterm-256color', cols: 80, rows: 24, cwd: process.cwd(), env: { ...(process.env as Record<string, string>) } });
	} catch (erreur) {
		return (erreur as Error).message;
	}
	let sorti = false;
	proc.onExit(() => {
		sorti = true;
	});
	if (await jusqua(() => sorti, DELAI_ESSAI_MS)) return null;
	signalerGroupe(proc.pid, 'SIGKILL', process.platform);
	return 'le processus d’essai ne s’est pas terminé';
}

/** Où l'utilisateur trouve comment installer node-pty. */
const VOIR_INSTALLATION = 'voir docs/installation.md';

/**
 * Terminaux par node-pty, importé à l'appel (paresseux : seul le service le charge). node-pty absent ou inutilisable →
 * mode dégradé : `disponibles()` rend le motif, `lancer` lève. Arrêt : `/exit`, puis SIGTERM au groupe du processus après
 * le délai, puis SIGKILL 3 s plus tard, jusqu'à ce qu'il ne reste rien du groupe (POSIX) ; `kill()` de node-pty sous Windows.
 */
export async function terminauxPty(reglages: ReglagesPty = {}): Promise<Terminaux> {
	const delai = reglages.delaiArretMs ?? DELAI_ARRET_MS;
	const plateforme = reglages.plateforme ?? process.platform;
	let mod: ModulePty | null = null;
	let motif: string | null = null;
	try {
		if (reglages.charger === undefined) reparerSpawnHelper();
		mod = moduleDe(await (reglages.charger ?? importerNodePty)());
		if (mod === null) motif = `node-pty n'est pas installé : module sans fonction spawn ; ${VOIR_INSTALLATION}`;
		else {
			const echec = await essayer(mod);
			if (echec !== null) {
				motif = `node-pty ne peut pas lancer de terminal : ${echec} ; ${VOIR_INSTALLATION}`;
				mod = null;
			}
		}
	} catch (erreur) {
		motif = `node-pty n'est pas installé : ${(erreur as Error).message} ; ${VOIR_INSTALLATION}`;
	}
	return {
		disponibles: () => (mod !== null ? { ok: true } : { ok: false, motif: motif ?? `node-pty n'est pas installé ; ${VOIR_INSTALLATION}` }),
		lancer(o: OptionsTerminal): Terminal {
			if (mod === null) throw new Error(motif ?? `node-pty n'est pas installé ; ${VOIR_INSTALLATION}`);
			const proc = mod.spawn(o.commande, o.args, { name: 'xterm-256color', cols: o.colonnes, rows: o.lignes, cwd: o.dossier, env: o.env });
			return terminalPty(proc, delai, plateforme, o.touches ?? TOUCHES_CLAUDE_CODE);
		},
	};
}
