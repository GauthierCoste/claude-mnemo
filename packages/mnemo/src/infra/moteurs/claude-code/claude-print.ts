/**
 * Un `claude -p` lancé par Mnemo hors d'une session (l'archiviste du banc, le juge du banc) : exécution par le port `Executer`,
 * jamais par un shell, avec délai et signal d'abandon ; un échec rend un motif lisible, jamais la ligne de commande (mission,
 * texte jugé, chemins, JSON).
 */
import type { CommandeMoteur, Executer } from '../../../application/ports.ts';

/** Un `claude -p` qui n'a pas abouti ; `message` est lisible tel quel. */
export class EchecClaudePrint extends Error {
	override name = 'EchecClaudePrint';
}

/** « 30 minutes », « 1 minute », « 90 secondes ». */
function duree(ms: number): string {
	if (ms % 60_000 === 0) return `${ms / 60_000} minute${ms === 60_000 ? '' : 's'}`;
	return `${Math.round(ms / 1000)} secondes`;
}

/** Premières lignes non vides d'une sortie, pour un message d'erreur. */
export const extraitDeSortie = (texte: string): string => texte.split(/\r?\n/u).filter((l) => l.trim() !== '').slice(0, 5).join(' / ').slice(0, 500);

/** Motif lisible d'un `claude -p` qui n'a pas pu aboutir (abandon, délai, programme illancable). */
export function motifDEchecClaude(erreur: unknown, signal: AbortSignal | undefined, delaiMs: number): string {
	const e = (typeof erreur === 'object' && erreur !== null ? erreur : {}) as { name?: unknown; code?: unknown; killed?: unknown };
	if (signal?.aborted === true || e.name === 'AbortError') return 'claude -p interrompu : banc arrêté, processus tué.';
	if (typeof e.code === 'string') return `claude -p n'a pas pu aboutir (${e.code}).`;
	if (e.killed === true) return `claude -p tué au bout de ${duree(delaiMs)} : délai dépassé.`;
	return 'claude -p n\'a pas pu aboutir.';
}

/** Ce que reçoit un `claude -p` : arguments (après `claude.avant`), dossier courant, environnement complet, délai, abandon, entrée. */
export type AppelClaudePrint = { args: string[]; cwd: string; env: Record<string, string>; delaiMs: number; signal?: AbortSignal; entree?: string };

/**
 * Lance `claude` (`commande`, puis `avant`, puis `args`) et rend sa sortie ; `EchecClaudePrint` s'il est déjà abandonné (rien
 * n'est lancé), s'il ne se lance pas, dépasse le délai, est abandonné ou sort en échec (code et premières lignes de sa sortie
 * d'erreur, sinon de sa sortie).
 */
export async function executerClaudePrint(executer: Executer, claude: CommandeMoteur, a: AppelClaudePrint): Promise<{ sortie: string; erreur: string }> {
	if (a.signal?.aborted === true) throw new EchecClaudePrint(motifDEchecClaude(null, a.signal, a.delaiMs));
	let r: Awaited<ReturnType<Executer>>;
	try {
		r = await executer(claude.commande, [...claude.avant, ...a.args], {
			cwd: a.cwd,
			env: a.env,
			delaiMs: a.delaiMs,
			...(a.signal === undefined ? {} : { signal: a.signal }),
			...(a.entree === undefined ? {} : { entree: a.entree }),
		});
	} catch (erreur) {
		throw new EchecClaudePrint(motifDEchecClaude(erreur, a.signal, a.delaiMs));
	}
	if (r.code !== 0) throw new EchecClaudePrint(`claude -p a échoué (code ${r.code}) : ${extraitDeSortie(r.erreur) || extraitDeSortie(r.sortie) || 'sans message'}`);
	return { sortie: r.sortie, erreur: r.erreur };
}
