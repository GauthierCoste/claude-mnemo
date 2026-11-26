/**
 * Les calculs du service pour les sessions (hooks, affinage d'un classement en arrière-plan), comptés tant qu'ils tournent, et
 * l'instant où le dernier s'est fini : le réapprentissage en fond de la note n'est lancé ni pendant un calcul, ni juste après
 * (une session active en enchaîne d'autres).
 */
export type CalculsEnCours = {
	/** Un calcul commence ; la fonction rendue le dit fini (une seule fois comptée). */
	commencer(): () => void;
	/** Calculs en cours. */
	enCours(): number;
	/** Instant où le dernier calcul s'est fini (ou a commencé, s'il tourne encore) ; -Infinity : aucun. */
	dernierMs(): number;
};

export function calculsEnCours(maintenant: () => number = Date.now): CalculsEnCours {
	let enCours = 0;
	let dernier = -Infinity;
	return {
		commencer() {
			enCours += 1;
			dernier = maintenant();
			let fini = false;
			return () => {
				if (fini) return;
				fini = true;
				enCours -= 1;
				dernier = maintenant();
			};
		},
		enCours: () => enCours,
		dernierMs: () => dernier,
	};
}

/** `action` comptée comme un calcul tant qu'elle tourne (`calculs` absent : telle quelle). */
export function compte<A extends unknown[], R>(calculs: CalculsEnCours | undefined, action: (...a: A) => Promise<R>): (...a: A) => Promise<R> {
	if (calculs === undefined) return action;
	return async (...a) => {
		const fin = calculs.commencer();
		try {
			return await action(...a);
		} finally {
			fin();
		}
	};
}
