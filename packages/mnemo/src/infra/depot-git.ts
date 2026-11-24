import { execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import type { Depot } from '../application/ports.ts';
import { argumentsGit } from './git.ts';

/** Délai par défaut d'un appel à git : au-delà, le processus est tué et l'appel rejeté. */
export const DELAI_GIT_MS = 2000;

/** Un commit tel que git l'écrit (abrégé ou entier) : rien d'autre n'est passé à git comme révision. */
const RE_COMMIT = /^[0-9a-f]{4,64}$/u;

/** Échec de git qui n'est pas un délai dépassé : `code` de sortie de git. */
class ErreurGit extends Error {
	readonly code: number | null;
	constructor(message: string, code: number | null) {
		super(message);
		this.name = 'ErreurGit';
		this.code = code;
	}
}

/**
 * Dépôt git des dossiers de session (`racine` : dossier Mnemo absolu). Lecture seule : `GIT_OPTIONAL_LOCKS=0`, pour ne
 * jamais prendre le verrou de l'index d'un dépôt où l'utilisateur travaille. Jamais de shell ; chaque appel tué après
 * `delaiMs` ; `arreter` tue ceux qui tournent encore.
 */
export function depotGit(racine: string, options: { delaiMs?: number } = {}): Depot & { arreter(): void } {
	const delaiMs = options.delaiMs ?? DELAI_GIT_MS;
	/** Processus git en cours : `arreter` les tue (un hook qui sort ne laisse rien derrière lui). */
	const enCours = new Set<ChildProcess>();
	const absolu = (dossier: string): string => (isAbsolute(dossier) ? dossier : join(racine, ...dossier.split('/').filter((s) => s !== '')));

	function git(cwd: string, args: string[]): Promise<string> {
		return new Promise((resoudre, rejeter) => {
			const enfant = execFile(
				'git',
				argumentsGit([], args),
				{ cwd, timeout: delaiMs, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } },
				(erreur, sortie, sortieErreur) => {
					enCours.delete(enfant);
					if (erreur === null) {
						resoudre(sortie);
						return;
					}
					const e = erreur as NodeJS.ErrnoException & { killed?: boolean; code?: number | string };
					if (e.killed === true) rejeter(new Error(`git ${args[0]} : délai de ${delaiMs} ms dépassé.`));
					else rejeter(new ErreurGit(`git ${args[0]} a échoué : ${(sortieErreur || erreur.message).trim()}`, typeof e.code === 'number' ? e.code : null));
				},
			);
			enCours.add(enfant);
		});
	}

	/** Racine du dépôt qui contient `dossier`, ou null si ce n'est pas un dépôt (ou si le dossier n'existe pas). */
	async function racineDuDepot(dossier: string): Promise<string | null> {
		try {
			return (await git(absolu(dossier), ['rev-parse', '--show-toplevel'])).trim();
		} catch (erreur) {
			// git sorti en erreur, ou dossier absent (ENOENT, aussi rendu en `ErreurGit`) : pas un dépôt ; délai dépassé : rejeté
			if (erreur instanceof ErreurGit) return null;
			throw erreur;
		}
	}

	/** Sortie de git, ou null si git sort avec un code non nul (sans être tué). */
	async function ouNull(cwd: string, args: string[]): Promise<string | null> {
		try {
			return await git(cwd, args);
		} catch (erreur) {
			if (erreur instanceof ErreurGit) return null;
			throw erreur;
		}
	}

	const liste = (sortie: string): string[] => sortie.split('\0').filter((c) => c !== '');

	return {
		arreter() {
			for (const enfant of enCours) enfant.kill('SIGKILL');
			enCours.clear();
		},

		async etat(dossier) {
			const depot = await racineDuDepot(dossier);
			if (depot === null) return null;
			const [branche, commit] = await Promise.all([ouNull(depot, ['symbolic-ref', '--short', '-q', 'HEAD']), ouNull(depot, ['rev-parse', '-q', '--verify', 'HEAD^{commit}'])]);
			const net = (v: string | null) => (v === null || v.trim() === '' ? null : v.trim());
			return { branche: net(branche), commit: net(commit) };
		},

		async fichiersModifies(dossier, depuis, limite) {
			if (depuis !== null && !RE_COMMIT.test(depuis)) throw new Error(`Commit de départ invalide : « ${depuis} ».`);
			const depot = await racineDuDepot(dossier);
			if (depot === null) return { fichiers: [], total: 0 };
			const base = depuis ?? ((await ouNull(depot, ['rev-parse', '-q', '--verify', 'HEAD^{commit}'])) === null ? null : 'HEAD');
			// avec une base : l'arbre de travail comparé à elle (commits depuis, index et modifications) ; sans (dépôt vide) : l'index
			const suivis = base === null ? ['diff', '--cached', '--name-only', '-z', '--no-renames'] : ['diff', '--name-only', '-z', '--no-renames', base, '--'];
			const [modifies, nouveaux] = await Promise.all([git(depot, suivis), git(depot, ['ls-files', '-z', '--others', '--exclude-standard'])]);
			const tous = [...new Set([...liste(modifies), ...liste(nouveaux)])];
			return { fichiers: tous.slice(0, limite), total: tous.length };
		},

		async statuts(dossier, limite) {
			if ((await racineDuDepot(dossier)) === null) return null;
			const cwd = absolu(dossier);
			// chemins de `status` relatifs à la racine du dépôt : le préfixe du dossier est retiré
			const [prefixe, sortie] = await Promise.all([git(cwd, ['rev-parse', '--show-prefix']), git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames', '--', '.'])]);
			const avant = prefixe.trim();
			const fichiers: { chemin: string; statut: 'M' | 'A' | 'D' }[] = [];
			let total = 0;
			for (const brute of liste(sortie)) {
				const xy = brute.slice(0, 2);
				const chemin = brute.slice(3);
				if (!chemin.startsWith(avant)) continue;
				total++;
				if (fichiers.length >= limite) continue;
				const statut = xy === '??' || xy.includes('A') ? 'A' : xy.includes('D') ? 'D' : 'M';
				fichiers.push({ chemin: chemin.slice(avant.length), statut });
			}
			return { fichiers, total };
		},
	};
}
