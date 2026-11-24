/** Installations communes aux tests : minuterie simulée, attente des promesses en cours. */

export type MinuterieSimulee = {
	poser(f: () => void, ms: number): unknown;
	annuler(t: unknown): void;
	/** Délais posés, dans l'ordre (annulés compris). */
	delais: number[];
	/** Nombre de rappels en attente. */
	enAttente(): number;
	/** Exécute le prochain rappel en attente ; faux s'il n'y en a pas. */
	avancer(): boolean;
};

export function minuterieSimulee(): MinuterieSimulee {
	const attente: { id: number; f: () => void }[] = [];
	const delais: number[] = [];
	let suivant = 1;
	return {
		delais,
		poser(f, ms) {
			delais.push(ms);
			const id = suivant++;
			attente.push({ id, f });
			return id;
		},
		annuler(t) {
			const i = attente.findIndex((a) => a.id === t);
			if (i >= 0) attente.splice(i, 1);
		},
		enAttente: () => attente.length,
		avancer() {
			const a = attente.shift();
			if (!a) return false;
			a.f();
			return true;
		},
	};
}

/** Laisse passer les promesses déjà résolues (plusieurs tours de la file des microtâches). */
export async function laisserPasser(): Promise<void> {
	for (let i = 0; i < 5; i++) await Promise.resolve();
}
