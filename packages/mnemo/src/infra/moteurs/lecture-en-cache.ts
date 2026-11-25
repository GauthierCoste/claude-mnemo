import { avecDelaiGaranti, MARGE_DELAI_MS } from '../delai-garanti.ts';

/**
 * Réglages d'une lecture gardée en cache (version, modèles d'un moteur) : `gardeMs`, la durée d'une valeur lue ; `gardeEchecMs`,
 * plus courte, celle d'un échec (`estEchec` : le moteur peut être installé, réparé ou connecté entre-temps) ; `delaiMs`, le
 * délai de la lecture, garanti par un minuteur (`repli` au-delà, ou sur un rejet). `maintenant` : tests.
 */
export type ReglagesCache<T> = { gardeMs: number; gardeEchecMs: number; delaiMs: number; repli: T; estEchec(valeur: T): boolean; maintenant?: () => number };

type EnCache<T> = { jusquaMs: number; valeur: Promise<T> };

/** Lecture par clé, partagée tant qu'elle est gardée (une lecture en cours aussi) ; `relire` : sans le cache. */
export function lectureEnCache<T>(r: ReglagesCache<T>): (cle: string, lire: () => Promise<T>, relire?: boolean) => Promise<T> {
	const maintenant = r.maintenant ?? Date.now;
	const cache = new Map<string, EnCache<T>>();
	return (cle, lire, relire = false) => {
		const garde = cache.get(cle);
		if (!relire && garde !== undefined && garde.jusquaMs > maintenant()) return garde.valeur;
		const entree: EnCache<T> = { jusquaMs: maintenant() + r.gardeMs, valeur: Promise.resolve(r.repli) };
		entree.valeur = avecDelaiGaranti(
			lire().catch(() => r.repli),
			r.delaiMs + MARGE_DELAI_MS,
			r.repli,
		).then((valeur) => {
			if (r.estEchec(valeur)) entree.jusquaMs = Math.min(entree.jusquaMs, maintenant() + r.gardeEchecMs);
			return valeur;
		});
		cache.set(cle, entree);
		return entree.valeur;
	};
}
