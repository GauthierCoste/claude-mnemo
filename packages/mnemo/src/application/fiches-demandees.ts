/**
 * Fiches que l'utilisateur demande d'injecter dans une session (« Injecter dans la session », panneau Contexte), gardées dans le service
 * jusqu'au prochain message de la session (jamais après un outil), qui les injecte entières.
 */
export type FichesDemandees = {
	/** Ajoute `chemin` aux fiches à servir de la session ; rend la liste en attente. */
	demander(session: string, chemin: string): string[];
	/** Les fiches à servir de la session, retirées de l'attente. */
	prendre(session: string): string[];
	/** Remet des fiches prises mais pas servies (hook arrivé trop tard). */
	remettre(session: string, chemins: readonly string[]): void;
	/** Les fiches à servir de la session, sans les retirer. */
	voir(session: string): string[];
	/** Retire `chemin` des fiches à servir (annulé avant le hook) ; rend la liste en attente. */
	retirer(session: string, chemin: string): string[];
};

/** Fiches en attente au plus par session : au-delà, les plus anciennes sont oubliées. */
export const FICHES_DEMANDEES_MAX = 10;

export function fichesDemandees(): FichesDemandees {
	const parSession = new Map<string, string[]>();
	const poser = (session: string, chemins: string[]) => {
		const liste = [...new Set(chemins)].slice(-FICHES_DEMANDEES_MAX);
		if (liste.length === 0) parSession.delete(session);
		else parSession.set(session, liste);
		return [...liste];
	};
	return {
		demander: (session, chemin) => poser(session, [...(parSession.get(session) ?? []).filter((c) => c !== chemin), chemin]),
		prendre(session) {
			const liste = parSession.get(session) ?? [];
			parSession.delete(session);
			return liste;
		},
		remettre: (session, chemins) => void poser(session, [...chemins, ...(parSession.get(session) ?? [])]),
		voir: (session) => [...(parSession.get(session) ?? [])],
		retirer: (session, chemin) => poser(session, (parSession.get(session) ?? []).filter((c) => c !== chemin)),
	};
}
