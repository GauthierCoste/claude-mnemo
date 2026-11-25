import type { Dependances, EtatSessions, GesteANoter } from './ports.ts';

/** Un geste à noter ; `empreinte` absente : celle de la fiche dans l'index. */
export type GesteDemande = Omit<GesteANoter, 'empreinte'> & { empreinte?: string | null };

/**
 * Note un geste au journal durable, avec l'empreinte de la fiche (celle de l'index si elle n'est pas donnée ; null si la fiche
 * n'y est pas). Toute panne est avalée, comme pour le journal servi : un geste perdu ne bloque jamais un hook ni une route.
 */
export async function noterGeste(dep: Pick<Dependances, 'index'>, etat: Pick<EtatSessions, 'noterGeste'>, g: GesteDemande): Promise<void> {
	try {
		const empreinte = g.empreinte !== undefined ? g.empreinte : ((await dep.index.fiches()).find((f) => f.chemin === g.fiche)?.empreinte ?? null);
		await etat.noterGeste({ ...g, empreinte });
	} catch {
		// Geste perdu (base occupée, index indisponible) : rien d'autre n'en dépend.
	}
}
