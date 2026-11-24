import { estObjet } from './valeurs.ts';

/** Une fenêtre de quota du compte Claude : part consommée (0 à 100) et instant de sa remise à zéro (ms depuis l'époque). */
export type Quota = { pourcentage: number; remiseMs: number };

/** Quotas du compte Claude : fenêtre glissante de 5 heures et semaine ; une fenêtre absente est inconnue. */
export type Quotas = { cinqHeures?: Quota; semaine?: Quota };

/** Une fenêtre de `rate_limits` (`used_percentage` de 0 à 100, `resets_at` en secondes depuis l'époque) ; null si illisible. */
function quotaDe(fenetre: unknown): Quota | null {
	if (!estObjet(fenetre)) return null;
	const { used_percentage: part, resets_at: remise } = fenetre;
	if (typeof part !== 'number' || !Number.isFinite(part) || typeof remise !== 'number' || !Number.isFinite(remise) || remise <= 0) return null;
	return { pourcentage: Math.min(100, Math.max(0, Math.round(part))), remiseMs: Math.round(remise * 1000) };
}

/**
 * Quotas tirés du `rate_limits` que Claude Code donne à sa ligne d'état (`five_hour`, `seven_day`) ; null s'il n'y en a aucun
 * de lisible (compte sans quota, ou avant la première réponse de Claude).
 */
export function quotasDeLimites(limites: unknown): Quotas | null {
	if (!estObjet(limites)) return null;
	const cinqHeures = quotaDe(limites.five_hour);
	const semaine = quotaDe(limites.seven_day);
	if (cinqHeures === null && semaine === null) return null;
	return { ...(cinqHeures === null ? {} : { cinqHeures }), ...(semaine === null ? {} : { semaine }) };
}

const memeQuota = (a: Quota | undefined, b: Quota | undefined): boolean => a?.pourcentage === b?.pourcentage && a?.remiseMs === b?.remiseMs;

/** Vrai si les deux relevés disent la même chose (rien à diffuser). */
export function memesQuotas(a: Quotas | null, b: Quotas | null): boolean {
	if (a === null || b === null) return a === b;
	return memeQuota(a.cinqHeures, b.cinqHeures) && memeQuota(a.semaine, b.semaine);
}
