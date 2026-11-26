/**
 * Lit le `PATH` du terminal : le shell de connexion de l'utilisateur (`$SHELL`, sinon `/bin/zsh`) lancé sans shell
 * intermédiaire avec `-ilc` et une commande qui affiche le `PATH` entre deux marqueurs (`domaine/path-terminal.ts`), entrée
 * fermée, environnement minimal, 10 s au plus. Échec, délai dépassé, sortie sans `PATH` : repli sur `pathParDefaut`, et la
 * raison va au journal. Le lanceur est remplaçable (tests : jamais le vrai shell de l'utilisateur).
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { variable } from '@mnemo/commun';
import { argumentsShell, lirePathDeSortie, marqueurs, shellDeConnexion } from '../domaine/path-terminal.ts';
import { pathParDefaut } from './emplacement.ts';
import type { Journal } from './journal-app.ts';

export const DELAI_SHELL_MS = 10_000;
/** Variables transmises au shell (le reste de l'environnement de l'app n'a rien à y faire). */
const VARIABLES_TRANSMISES = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'PATH'] as const;

/** Lance `shell args` et rend sa sortie standard ; rejette sur un échec ou au-delà de `delaiMs`. */
export type LanceurShell = (shell: string, args: string[], options: { env: NodeJS.ProcessEnv; delaiMs: number }) => Promise<string>;

/** Sortie standard gardée au plus (octets) : au-delà, le shell est arrêté et la lecture échoue. */
export const SORTIE_MAX = 1024 * 1024;
/**
 * Après la sortie du shell, attente au plus de la fin de sa sortie standard : un processus lancé en arrière-plan par les
 * fichiers d'initialisation (et qui en hérite) la garde ouverte ; ce que le shell a écrit est déjà là.
 */
const DRAINAGE_MS = 200;

/**
 * Le vrai lanceur : `spawn` sans shell intermédiaire, entrée fermée (`/dev/null`), dans son propre groupe de processus
 * (sans terminal de contrôle). Conclut à la sortie du shell, sans attendre ses descendants ; au-delà du délai, ou d'une
 * sortie de plus de `SORTIE_MAX`, tout le groupe est tué (SIGKILL : un shell interactif ignore SIGTERM).
 */
export const lanceurShellReel: LanceurShell = (shell, args, { env, delaiMs }) =>
	new Promise((resoudre, rejeter) => {
		const enfant = spawn(shell, args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true, windowsHide: true });
		const morceaux: Buffer[] = [];
		let taille = 0;
		let erreurs = '';
		let fini = false;
		let drainage: NodeJS.Timeout | undefined;
		const tuer = (): void => {
			try {
				if (enfant.pid !== undefined) process.kill(-enfant.pid, 'SIGKILL');
			} catch {
				// groupe déjà vide
			}
		};
		const conclure = (resultat: { sortie: string } | { erreur: Error }): void => {
			if (fini) return;
			fini = true;
			clearTimeout(delai);
			clearTimeout(drainage);
			enfant.stdout.destroy();
			enfant.stderr.destroy();
			if ('erreur' in resultat) rejeter(resultat.erreur);
			else resoudre(resultat.sortie);
		};
		const delai = setTimeout(() => {
			tuer();
			conclure({ erreur: new Error(`pas de réponse en ${delaiMs / 1000} s.`) });
		}, delaiMs);
		enfant.stdout.on('data', (morceau: Buffer) => {
			taille += morceau.length;
			if (taille > SORTIE_MAX) {
				tuer();
				conclure({ erreur: new Error(`sortie de plus de ${SORTIE_MAX} octets.`) });
				return;
			}
			morceaux.push(morceau);
		});
		enfant.stderr.setEncoding('utf8');
		enfant.stderr.on('data', (morceau: string) => {
			erreurs = (erreurs + morceau).slice(-2000);
		});
		enfant.on('error', (erreur) => conclure({ erreur }));
		const sortieLue = (code: number | null, signal: NodeJS.Signals | null): void => {
			if (code === 0) return conclure({ sortie: Buffer.concat(morceaux).toString('utf8') });
			const raison = erreurs.trim().split('\n').at(-1)?.trim() ?? '';
			conclure({ erreur: new Error(`${signal !== null ? `arrêté (${signal})` : `code de sortie ${code}`}${raison === '' ? '.' : ` : ${raison}`}`) });
		};
		enfant.on('exit', (code, signal) => {
			drainage = setTimeout(() => sortieLue(code, signal), DRAINAGE_MS);
			enfant.stdout.once('end', () => {
				// les données lues avant la fin sont toutes passées par « data »
				setImmediate(() => sortieLue(code, signal));
			});
			if (enfant.stdout.readableEnded) setImmediate(() => sortieLue(code, signal));
		});
	});

/** Environnement minimal donné au shell : quelques variables de l'app, rien d'autre. */
export function environnementShell(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const cle of VARIABLES_TRANSMISES) if (base[cle] !== undefined) env[cle] = base[cle];
	return env;
}

export type OptionsPathTerminal = {
	home: string;
	/** Environnement de l'app (`$SHELL`, et ce qui est transmis au shell) ; par défaut `process.env`. */
	base?: NodeJS.ProcessEnv;
	plateforme?: NodeJS.Platform;
	lanceur?: LanceurShell;
	journal?: Journal;
	delaiMs?: number;
};

/** `origine` : `shell` (lu dans le shell de connexion) ou `defaut` (repli, `raison` dit pourquoi). */
export type PathTerminal = { path: string; origine: 'shell' } | { path: string; origine: 'defaut'; raison: string };

/** Le `PATH` du shell de connexion ; sinon (Windows, échec, sortie sans `PATH`) `pathParDefaut`, et la raison au journal. */
export async function lirePathTerminal(o: OptionsPathTerminal): Promise<PathTerminal> {
	const base = o.base ?? process.env;
	const plateforme = o.plateforme ?? process.platform;
	const repli = (raison: string): PathTerminal => {
		o.journal?.(`PATH du terminal non lu (${raison}) : PATH par défaut.`);
		return { path: pathParDefaut(o.home, variable(base, 'PATH', plateforme), plateforme), origine: 'defaut', raison };
	};
	if (plateforme === 'win32') return repli('Windows : pas de shell de connexion.');
	const shell = shellDeConnexion(base['SHELL']);
	const m = marqueurs(randomBytes(8).toString('hex'));
	let sortie: string;
	try {
		sortie = await (o.lanceur ?? lanceurShellReel)(shell, argumentsShell(m), { env: environnementShell(base), delaiMs: o.delaiMs ?? DELAI_SHELL_MS });
	} catch (e) {
		return repli(`${shell} : ${e instanceof Error ? e.message : String(e)}`);
	}
	const lu = lirePathDeSortie(sortie, m);
	return lu.ok ? { path: lu.path, origine: 'shell' } : repli(`${shell} : ${lu.raison}`);
}
