/** Une fenêtre de quota d'un abonnement : part consommée (0 à 100) et instant de sa remise à zéro (ms depuis l'époque). */
export type Quota = { pourcentage: number; remiseMs: number };

/**
 * Quotas de l'abonnement d'un moteur (compte Claude pour Claude Code, compte ChatGPT pour Codex) : fenêtre glissante de
 * 5 heures et semaine ; une fenêtre absente est inconnue. `releveMs` : instant du relevé (ms depuis l'époque), quand il est connu.
 */
export type Quotas = { cinqHeures?: Quota; semaine?: Quota; releveMs?: number };

const memeQuota = (a: Quota | undefined, b: Quota | undefined): boolean => a?.pourcentage === b?.pourcentage && a?.remiseMs === b?.remiseMs;

/** Vrai si les deux relevés disent la même chose des fenêtres (rien à diffuser), quel que soit leur instant de relevé. */
export function memesQuotas(a: Quotas | null | undefined, b: Quotas | null | undefined): boolean {
	if (a == null || b == null) return (a ?? null) === (b ?? null);
	return memeQuota(a.cinqHeures, b.cinqHeures) && memeQuota(a.semaine, b.semaine);
}

/** Âge au-delà duquel un relevé lu dans une transcription n'est plus cru (session reprise, service redémarré). */
export const AGE_MAX_RELEVE_MS = 3_600_000;

/**
 * Le relevé à garder d'un moteur, lu dans une transcription, à la place de `avant` ; null : ignoré. Sans instant : gardé
 * (relevé maintenant) seulement si aucun n'est encore gardé ; plus vieux que `AGE_MAX_RELEVE_MS` ou que `avant` : ignoré.
 */
export function releveAGarder(avant: Quotas | undefined, recus: Quotas, maintenantMs: number): Quotas | null {
	if (recus.releveMs === undefined) return avant === undefined ? { ...recus, releveMs: maintenantMs } : null;
	if (recus.releveMs < maintenantMs - AGE_MAX_RELEVE_MS) return null;
	if (avant?.releveMs !== undefined && recus.releveMs < avant.releveMs) return null;
	return recus;
}
