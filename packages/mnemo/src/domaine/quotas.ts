/** Une fenêtre de quota du compte Claude : part consommée (0 à 100) et instant de sa remise à zéro (ms depuis l'époque). */
export type Quota = { pourcentage: number; remiseMs: number };

/** Quotas du compte Claude : fenêtre glissante de 5 heures et semaine ; une fenêtre absente est inconnue. */
export type Quotas = { cinqHeures?: Quota; semaine?: Quota };

const memeQuota = (a: Quota | undefined, b: Quota | undefined): boolean => a?.pourcentage === b?.pourcentage && a?.remiseMs === b?.remiseMs;

/** Vrai si les deux relevés disent la même chose (rien à diffuser). */
export function memesQuotas(a: Quotas | null, b: Quotas | null): boolean {
	if (a === null || b === null) return a === b;
	return memeQuota(a.cinqHeures, b.cinqHeures) && memeQuota(a.semaine, b.semaine);
}
