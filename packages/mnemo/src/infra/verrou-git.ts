import { stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { sonderProcessus } from './processus.ts';

/** Un `index.lock` plus vieux que ceci, sans git en cours, est le reste d'un git tué (hook `fin` coupé par Claude Code). */
export const AGE_VERROU_PERIME_MS = 60_000;

/**
 * `gitEnCours` : un processus git tourne-t-il (null : on ne sait pas) ; `journal` : la ligne écrite quand un verrou est
 * retiré (stderr par défaut : jamais stdout, réservé au protocole MCP et aux réponses des hooks).
 */
export type OptionsVerrouGit = { gitEnCours?: () => Promise<boolean | null>; journal?: (m: string) => void };

/** Nom de commande d'un processus git : `git`, `git.exe`, ou une sous-commande `git-…` (chemin complet ou non). */
export function estProcessusGit(commande: string): boolean {
	const nom = (commande.trim().split(/[\\/]/u).at(-1) ?? '').replace(/\.exe$/iu, '').toLowerCase();
	return nom === 'git' || nom.startsWith('git-');
}

/** Liste des noms de processus de la machine, par un outil du système (sans shell). */
export type CommandeProcessus = { commande: string; args: string[] };

export function commandeDesProcessus(plateforme: NodeJS.Platform): CommandeProcessus {
	return plateforme === 'win32' ? { commande: 'tasklist', args: ['/FO', 'CSV', '/NH'] } : { commande: 'ps', args: ['-A', '-o', 'comm='] };
}

/** Noms lus dans la sortie de `commandeDesProcessus` : une ligne par processus ; `tasklist` met le nom dans le premier champ CSV. */
export function nomsDesProcessus(sortie: string, plateforme: NodeJS.Platform): string[] {
	const lignes = sortie.split(/\r?\n/u).filter((l) => l.trim() !== '');
	if (plateforme !== 'win32') return lignes;
	return lignes.map((l) => /^"([^"]*)"/u.exec(l)?.[1] ?? l);
}

/**
 * Un git tourne-t-il sur cette machine (n'importe quel dépôt : prudent, le dossier courant d'un processus ne se lit pas sans
 * outil externe) ? null si la liste des processus échoue.
 */
export async function gitEnCoursSurLaMachine(): Promise<boolean | null> {
	const { commande, args } = commandeDesProcessus(process.platform);
	const sortie = await sonderProcessus(commande, args);
	return sortie === null ? null : nomsDesProcessus(sortie, process.platform).some(estProcessusGit);
}

const journalParDefaut = (m: string): void => {
	try {
		process.stderr.write(`mnemo : ${m}\n`);
	} catch {
		// stderr fermé : la ligne est perdue
	}
};

/**
 * Avant une écriture de la mémoire : `<dépôt>/.git/index.lock` retiré s'il a plus de 60 s et qu'aucun git ne tourne (une
 * ligne de journal). Rend vrai s'il a été retiré. Récent, git en cours ou inconnu : gardé (git refusera comme avant).
 */
export async function retirerVerrouGitPerime(racineDepot: string, options: OptionsVerrouGit = {}): Promise<boolean> {
	const verrou = join(racineDepot, '.git', 'index.lock');
	let ageMs: number;
	try {
		ageMs = Date.now() - (await stat(verrou)).mtimeMs;
	} catch {
		return false;
	}
	if (ageMs <= AGE_VERROU_PERIME_MS) return false;
	if ((await (options.gitEnCours ?? gitEnCoursSurLaMachine)()) !== false) return false;
	try {
		await unlink(verrou);
	} catch {
		return false;
	}
	(options.journal ?? journalParDefaut)(`verrou git périmé retiré (${verrou}, ${Math.round(ageMs / 1000)} s, aucun git en cours).`);
	return true;
}
