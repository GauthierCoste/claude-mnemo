/** Erreur attendue : message en français, code de sortie, pas de trace. */
export class ErreurCli extends Error {
	code: number;
	constructor(message: string, code = 1) {
		super(message);
		this.code = code;
	}
}

export const AUCUNE_MEMOIRE = 'Aucune mémoire Mnemo trouvée ici ni dans les dossiers parents. Lancer « mnemo init » pour en créer une.';
