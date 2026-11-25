import { realpath } from 'node:fs/promises';
import { extname, isAbsolute, relative } from 'node:path';

/** Vrai si `chemin` (réel) est dans `racine` (réelle), sans en être la racine. */
export function dans(racine: string, chemin: string): boolean {
	const r = relative(racine, chemin);
	return r !== '' && !r.startsWith('..') && !isAbsolute(r);
}

/** Chemins réels des `candidates` qui existent, sans doublon. */
export async function racinesReelles(candidates: readonly string[]): Promise<string[]> {
	const reelles = await Promise.all([...new Set(candidates)].map((c) => realpath(c).catch(() => null)));
	return [...new Set(reelles.filter((c): c is string => c !== null))];
}

/**
 * Le chemin réel de `chemin` s'il est (liens résolus) sous l'une des `racines` réelles, avec l'extension `extension` (avant et
 * après résolution) quand elle est donnée ; null sinon : un chemin reçu d'un hook n'est jamais lu ailleurs.
 */
export async function cheminReelPermis(chemin: string, racines: readonly string[], extension?: string): Promise<string | null> {
	if (extension !== undefined && extname(chemin) !== extension) return null;
	const reel = await realpath(chemin).catch(() => null);
	if (reel === null || (extension !== undefined && extname(reel) !== extension) || !racines.some((racine) => dans(racine, reel))) return null;
	return reel;
}
