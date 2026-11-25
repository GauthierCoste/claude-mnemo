import { citerPosix } from '../citer.ts';

/** Shells dont `-c` / `-lc` porte une ligne de commande : `sh`, `bash`, `zsh`, ou leur chemin. */
const SHELL = /(?:^|[\\/])(?:sh|bash|zsh)(?:\.exe)?$/iu;
/** Un argument qui se lit tel quel dans une ligne de commande POSIX. */
const MOT_SIMPLE = /^[A-Za-z0-9_\-./=:,+@%]+$/u;

/**
 * Ligne de commande d'une entrée `command` (ou `cmd`) : une chaîne telle quelle ; une liste `[<shell>, -c | -lc, …, <ligne>]`
 * rend sa dernière ligne ; toute autre liste, ses éléments cités au besoin puis joints. null : aucune des deux formes.
 */
export function ligneDeCommande(brut: unknown): string | null {
	if (typeof brut === 'string') return brut;
	if (!Array.isArray(brut) || !brut.every((a): a is string => typeof a === 'string')) return null;
	if (brut.length >= 3 && SHELL.test(brut[0]!) && (brut[1] === '-c' || brut[1] === '-lc')) return brut[brut.length - 1]!;
	return brut.map((a) => (MOT_SIMPLE.test(a) ? a : citerPosix(a))).join(' ');
}
