/** Clés gardées par le cache des ressources : un onglet ouvert des jours ne garde pas chaque recherche tapée. */
export const TAILLE_CACHE_RESSOURCES = 200;

/** Cache à taille bornée : au-delà de `capacite`, la clé lue ou écrite le moins récemment est évincée. */
export class CacheBorne {
	readonly #capacite: number;
	readonly #entrees = new Map<string, unknown>();

	constructor(capacite: number) {
		this.#capacite = capacite;
	}

	get taille(): number {
		return this.#entrees.size;
	}

	get(cle: string): unknown {
		if (!this.#entrees.has(cle)) return undefined;
		const valeur = this.#entrees.get(cle);
		this.#entrees.delete(cle);
		this.#entrees.set(cle, valeur);
		return valeur;
	}

	set(cle: string, valeur: unknown): void {
		this.#entrees.delete(cle);
		this.#entrees.set(cle, valeur);
		if (this.#entrees.size > this.#capacite) this.#entrees.delete(this.#entrees.keys().next().value!);
	}
}
