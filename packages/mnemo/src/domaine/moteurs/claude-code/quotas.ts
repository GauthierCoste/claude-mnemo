import type { Quota, Quotas } from '../../quotas.ts';
import { estObjet } from '../../valeurs.ts';

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
