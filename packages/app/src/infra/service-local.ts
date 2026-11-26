/**
 * `<racine>/.mnemo/service.json`, écrit par le service vivant (`{ pid, port, jeton, demarre }`) : mêmes règles de lecture que
 * `lireService` de `packages/mnemo` (`src/infra/service-local.ts`), dont l'app ne dépend pas.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Ce que `.mnemo/service.json` dit du service vivant d'un dossier. */
export type ServiceLocal = { pid: number; port: number; jeton: string; demarre: number };

/** Dossier local (hors mémoire, ignoré par git) du dossier Mnemo, comme `DOSSIER_LOCAL` du service. */
export const DOSSIER_LOCAL = '.mnemo';

const entier = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

export function cheminServiceJson(racine: string): string {
	return join(racine, DOSSIER_LOCAL, 'service.json');
}

export function cheminJournal(racine: string): string {
	return join(racine, DOSSIER_LOCAL, 'service.log');
}

/** `.mnemo/service.json` du dossier Mnemo `racine`, s'il existe et se lit ; null sinon (jamais d'erreur). */
export function lireServiceJson(racine: string): ServiceLocal | null {
	let brut: unknown;
	try {
		brut = JSON.parse(readFileSync(cheminServiceJson(racine), 'utf8'));
	} catch {
		return null;
	}
	if (typeof brut !== 'object' || brut === null) return null;
	const { pid, port, jeton, demarre } = brut as Record<string, unknown>;
	if (!entier(pid, 1, Number.MAX_SAFE_INTEGER) || !entier(port, 1, 65535) || typeof jeton !== 'string' || !/^[0-9a-f]{64}$/u.test(jeton)) return null;
	if (typeof demarre !== 'number' || !Number.isFinite(demarre)) return null;
	return { pid, port, jeton, demarre };
}

/** Même service (le jeton, stable d'un démarrage à l'autre, ne les distingue pas). */
export function memeService(a: ServiceLocal, b: ServiceLocal): boolean {
	return a.pid === b.pid && a.port === b.port && a.demarre === b.demarre;
}

/** Vrai si le processus existe encore (signal 0 ; EPERM : il existe, sous un autre utilisateur). */
export function processusVivant(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === 'EPERM';
	}
}
