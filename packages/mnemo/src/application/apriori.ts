import { aprioris, JOUR_MS, sansEcarteesToujours, suggestionsEcarteeToujours, voixDesGestes } from '../domaine/apriori-gestes.ts';
import type { ContexteApriori, SuggestionEcarteeToujours, Voix } from '../domaine/apriori-gestes.ts';
import type { EtatSessions, GesteNote } from './ports.ts';

/** Gestes relus au plus : au-delà de 3 demi-vies (180 jours), un geste pèse moins d'un huitième ; 5 000 bornent la mémoire (vecteurs compris). */
export const HORIZON_GESTES_MS = 365 * JOUR_MS;
export const GESTES_GARDES_MAX = 5000;

/**
 * L'a priori des gestes, tenu par le service : les gestes du journal (horizon et nombre bornés) et les voix de chaque fiche
 * sont gardés en mémoire ; `actualiser` ne relit que les gestes nouveaux (rang au-delà du dernier lu) et ne recalcule que
 * les fiches qu'ils touchent. Le classement ne fait ensuite qu'une lecture (`aprioris`), sans accès à la base.
 */
export type AprioriDesGestes = {
	/** Relit les gestes nouveaux du journal (et les écartées toujours si `ecartees` : après un geste « écartée toujours » ou un rétablissement). */
	actualiser(options?: { ecartees?: boolean }): Promise<void>;
	/** A priori de chaque fiche qui a des voix, pour ce message (les autres : 0). */
	aprioris(contexte: ContexteApriori): Map<string, number>;
	/** Fiches que la règle des 3 sessions propose d'écarter toujours (jamais appliquée seule) ; `session` : celles qu'elle a écartées. */
	suggestions(session?: string): SuggestionEcarteeToujours[];
	/** Fiches écartées toujours (lues à la dernière actualisation). */
	ecarteesToujours(): ReadonlySet<string>;
	/** Les candidates, sans celles dont la fiche est écartée toujours : à appeler par le classement avant de noter. */
	exclusDefinitivement<T extends string | { id: string } | { chemin: string }>(candidates: readonly T[]): T[];
	/** Une session supprimée : le texte et le vecteur de ses messages quittent aussi la mémoire du service. */
	oublierSession(session: string): void;
};

/** Le jour local d'un instant (règle des 3 sessions : « sur au moins 2 jours » se compte comme l'utilisateur les vit). */
function jourLocal(ms: number): number {
	const d = new Date(ms);
	return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / JOUR_MS;
}

const idDe = (c: string | { id: string } | { chemin: string }): string => (typeof c === 'string' ? c : 'id' in c ? c.id : c.chemin);

export function aprioriDesGestes(etat: Pick<EtatSessions, 'gestes' | 'ecarteesToujours'>, horloge: () => number = Date.now): AprioriDesGestes {
	/** Gestes gardés, par rang ; leurs voix par fiche. */
	const gestes = new Map<number, GesteNote>();
	const parFiche = new Map<string, GesteNote[]>();
	const voix = new Map<string, Voix[]>();
	let suggestionsCalculees: SuggestionEcarteeToujours[] = [];
	let ecartees = new Set<string>();
	let dernierRang = 0;
	let charge = false;
	let enCours: Promise<void> | null = null;

	const recalculer = (fiches: Iterable<string>): void => {
		for (const fiche of fiches) {
			const liste = parFiche.get(fiche) ?? [];
			if (liste.length === 0) {
				parFiche.delete(fiche);
				voix.delete(fiche);
			} else voix.set(fiche, voixDesGestes(liste));
		}
		suggestionsCalculees = suggestionsEcarteeToujours([...gestes.values()], ecartees, jourLocal);
	};

	const ajouter = (g: GesteNote): void => {
		gestes.set(g.rang, g);
		const liste = parFiche.get(g.fiche) ?? [];
		liste.push(g);
		parFiche.set(g.fiche, liste);
		dernierRang = Math.max(dernierRang, g.rang);
	};

	/** Hors horizon ou au-delà du nombre gardé : les plus anciens partent. */
	const elaguer = (touchees: Set<string>): void => {
		const limite = horloge() - HORIZON_GESTES_MS;
		const tries = [...gestes.values()].sort((a, b) => a.horodatageMs - b.horodatageMs || a.rang - b.rang);
		const enTrop = Math.max(0, tries.length - GESTES_GARDES_MAX);
		for (const [i, g] of tries.entries()) {
			if (i >= enTrop && g.horodatageMs >= limite) break;
			gestes.delete(g.rang);
			touchees.add(g.fiche);
		}
		for (const fiche of touchees) parFiche.set(fiche, (parFiche.get(fiche) ?? []).filter((g) => gestes.has(g.rang)));
	};

	const lire = async (lireEcartees: boolean): Promise<void> => {
		const touchees = new Set<string>();
		const nouveaux = charge
			? await etat.gestes({ depuisRang: dernierRang + 1, limite: null })
			: await etat.gestes({ depuisMs: horloge() - HORIZON_GESTES_MS, limite: GESTES_GARDES_MAX });
		for (const g of nouveaux) {
			if (gestes.has(g.rang)) continue;
			ajouter(g);
			touchees.add(g.fiche);
		}
		const relireEcartees = lireEcartees || !charge;
		if (relireEcartees) ecartees = new Set((await etat.ecarteesToujours()).map((e) => e.fiche));
		if (nouveaux.length > 0) elaguer(touchees);
		charge = true;
		if (touchees.size > 0 || relireEcartees) recalculer(touchees);
	};

	return {
		async actualiser(options = {}) {
			// une lecture à la fois : une demande arrivée pendant une lecture en refait une après elle
			const avant = enCours ?? Promise.resolve();
			const suivante = avant.then(() => lire(options.ecartees === true));
			enCours = suivante.catch(() => {});
			await suivante;
		},
		aprioris: (contexte) => aprioris(voix, contexte),
		suggestions: (session) => (session === undefined ? suggestionsCalculees : suggestionsCalculees.filter((s) => s.sessions.includes(session))),
		ecarteesToujours: () => ecartees,
		exclusDefinitivement: (candidates) => sansEcarteesToujours(candidates, ecartees, idDe),
		oublierSession(session) {
			const touchees = new Set<string>();
			for (const g of gestes.values()) {
				if (g.session !== session || (g.vecteur === null && g.message === null)) continue;
				const sans = { ...g, message: null, vecteur: null };
				gestes.set(g.rang, sans);
				parFiche.set(g.fiche, (parFiche.get(g.fiche) ?? []).map((x) => (x.rang === g.rang ? sans : x)));
				touchees.add(g.fiche);
			}
			if (touchees.size > 0) recalculer(touchees);
		},
	};
}
