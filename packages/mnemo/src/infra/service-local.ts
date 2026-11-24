import { chmodSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { requeteLocale } from './modeles/http-local.ts';
import { existenceProcessus } from './processus.ts';
import { DOSSIER_LOCAL } from '../domaine/dossier-memoire.ts';

/** Ce que `.mnemo/service.json` dit du service vivant de ce dossier. */
export type ServiceLocal = { pid: number; port: number; jeton: string; demarre: number };

const entier = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** `.mnemo/service.json` du dossier Mnemo `racine`, s'il existe et se lit ; null sinon (jamais d'erreur). */
export function lireService(racine: string): ServiceLocal | null {
	let brut: unknown;
	try {
		brut = JSON.parse(readFileSync(join(racine, DOSSIER_LOCAL, 'service.json'), 'utf8'));
	} catch {
		return null;
	}
	if (typeof brut !== 'object' || brut === null) return null;
	const { pid, port, jeton, demarre } = brut as Record<string, unknown>;
	if (!entier(pid, 1, Number.MAX_SAFE_INTEGER) || !entier(port, 1, 65535) || typeof jeton !== 'string' || !/^[0-9a-f]{64}$/u.test(jeton)) return null;
	if (typeof demarre !== 'number' || !Number.isFinite(demarre)) return null;
	return { pid, port, jeton, demarre };
}

/** Vrai si le processus du service existe encore (signal 0 ; EPERM : il existe, sous un autre utilisateur). */
export function processusVivant(pid: number): boolean {
	return existenceProcessus(pid) !== 'non';
}

/**
 * `POST <chemin>` au service (127.0.0.1, jeton), corps JSON, abandonné après `delaiMs`. Rend le corps JSON d'une réponse 2xx ;
 * toute erreur (refus de connexion, délai, statut, corps non JSON) → null. La forme du corps reste à vérifier par l'appelant.
 */
export async function appelerService<T>(s: ServiceLocal, chemin: string, corps: unknown, delaiMs: number): Promise<T | null> {
	try {
		const reponse = await requeteLocale(s.port, chemin, { cle: s.jeton, finMs: Date.now() + delaiMs, corps });
		if (reponse === null || reponse.statut < 200 || reponse.statut >= 300 || reponse.corps === undefined) return null;
		return reponse.corps as T;
	} catch {
		return null;
	}
}

const fichierService = (racine: string) => join(racine, DOSSIER_LOCAL, 'service.json');

// Ce module est chargé par chaque hook : il n'importe rien de lourd (le verrou du service, qui interroge `ps`, est dans
// `verrou-service.ts`). `.mnemo/` doit exister (`preparerDossierLocal`) avant `ecrireService`.

/**
 * Écrit `.mnemo/service.json` (droits 0600) de façon atomique : fichier temporaire propre à ce processus, puis renommage. Un
 * hook ne lit jamais un fichier à moitié écrit.
 */
export function ecrireService(racine: string, s: ServiceLocal): void {
	const local = join(racine, DOSSIER_LOCAL);
	const temporaire = join(local, `service.json.${process.pid}.tmp`);
	writeFileSync(temporaire, `${JSON.stringify({ pid: s.pid, port: s.port, jeton: s.jeton, demarre: s.demarre })}\n`, { mode: 0o600 });
	// le mode de création passe par le masque de l'utilisateur : imposé ensuite
	chmodSync(temporaire, 0o600);
	renameSync(temporaire, fichierService(racine));
}

/**
 * Retire `.mnemo/service.json` s'il est bien celui de ce service (même pid, port et démarrage : le jeton, stable d'un démarrage
 * à l'autre, ne les distingue pas) ; un fichier d'un autre service reste.
 */
export function retirerService(racine: string, s: Pick<ServiceLocal, 'pid' | 'port' | 'demarre'>): void {
	const lu = lireService(racine);
	if (lu === null || lu.pid !== s.pid || lu.port !== s.port || lu.demarre !== s.demarre) return;
	try {
		unlinkSync(fichierService(racine));
	} catch {
		// déjà retiré
	}
}
