import { aprioris, DEMI_VIE_GESTE_JOURS, JOUR_MS, jourLocal, sansEcarteesToujours, suggestionsEcarteeToujours, voixDesGestes } from '../domaine/apriori-gestes.ts';
import type { ContexteApriori, GesteDApriori, SuggestionEcarteeToujours, VecteurDApriori, Voix } from '../domaine/apriori-gestes.ts';
import type { EcarteeToujours, EtatSessions, GesteNote } from './ports.ts';

/** Gestes relus au plus : au-delà de 3 demi-vies (180 jours), un geste pèse moins d'un huitième ; 5 000 bornent la mémoire (vecteurs compris). */
export const HORIZON_GESTES_MS = 365 * JOUR_MS;
export const GESTES_GARDES_MAX = 5000;

/**
 * L'a priori des gestes, tenu par le service : les gestes du journal (horizon et nombre bornés ; ni texte ni note, un
 * vecteur par message) et les voix de chaque fiche sont gardés en mémoire ; `actualiser` ne relit que les gestes nouveaux
 * (rang au-delà du dernier lu) et ne recalcule que les fiches qu'ils touchent. Le classement ne fait ensuite qu'une
 * lecture (`aprioris`), sans accès à la base.
 */
export type AprioriDesGestes = {
	/**
	 * Relit les gestes nouveaux du journal (et les écartées toujours si `ecartees` : après un geste « écartée toujours » ou un
	 * rétablissement) ; rend les sessions dont la liste de suggestions a changé. Une demande faite pendant une lecture attend
	 * la suivante, une seule pour toutes celles qui arrivent entre-temps.
	 */
	actualiser(options?: { ecartees?: boolean }): Promise<Set<string>>;
	/** A priori de chaque fiche qui a des voix, pour ce message (les autres : 0). */
	aprioris(contexte: ContexteApriori): Map<string, number>;
	/**
	 * Fiches que la règle des 3 sessions propose d'écarter toujours (jamais appliquée seule), présentes dans l'index à la
	 * dernière lecture ; `session` : celles qu'elle a écartées.
	 */
	suggestions(session?: string): SuggestionEcarteeToujours[];
	/** Fiches écartées toujours (lues à la dernière actualisation). */
	ecarteesToujours(): ReadonlySet<string>;
	/** Les candidates, sans celles dont la fiche est écartée toujours : à appeler par le classement avant de noter. */
	exclusDefinitivement<T extends string | { id: string } | { chemin: string }>(candidates: readonly T[]): T[];
	/** Une session supprimée : le vecteur de ses messages quitte aussi la mémoire du service. */
	oublierSession(session: string): void;
	/** Ce que le service garde : gestes et vecteurs (un par message). */
	taille(): { gestes: number; vecteurs: number };
};

export type OptionsApriori = {
	horloge?: () => number;
	/** Chemins des fiches de l'index : une suggestion pour une fiche qui n'y est plus n'est pas montrée. Absent : pas de filtre. */
	chemins?: () => Promise<Iterable<string>>;
	/** Journal du service (élagage de gestes récents, signalé une fois). */
	journal?: (message: string) => void;
	/** Gestes gardés au plus (défaut : `GESTES_GARDES_MAX`). */
	gestesMax?: number;
};

/** Un geste gardé par le service : ce que l'a priori lit, et son rang (ordre d'écriture). */
type GesteGarde = GesteDApriori & { rang: number };

const idDe = (c: string | { id: string } | { chemin: string }): string => (typeof c === 'string' ? c : 'id' in c ? c.id : c.chemin);
const cleDuMessage = (session: string, rangMessage: number): string => `${session}\u0000${rangMessage}`;

export function aprioriDesGestes(etat: Pick<EtatSessions, 'gestes' | 'ecarteesToujours'>, options: OptionsApriori = {}): AprioriDesGestes {
	const horloge = options.horloge ?? Date.now;
	const gestesMax = options.gestesMax ?? GESTES_GARDES_MAX;
	/** Gestes gardés, par rang ; par fiche ; leurs voix par fiche. */
	const gestes = new Map<number, GesteGarde>();
	const parFiche = new Map<string, GesteGarde[]>();
	const voix = new Map<string, Voix[]>();
	/** Un vecteur par message (session et rang du message), partagé par ses gestes. */
	const vecteurs = new Map<string, VecteurDApriori>();
	let suggestionsCalculees: SuggestionEcarteeToujours[] = [];
	let ecartees = new Set<string>();
	let retablissements = new Map<string, number>();
	let presentes: ReadonlySet<string> | null = null;
	let dernierRang = 0;
	let charge = false;
	let elagageSignale = false;

	const visibles = (): SuggestionEcarteeToujours[] => (presentes === null ? suggestionsCalculees : suggestionsCalculees.filter((s) => presentes!.has(s.fiche)));

	/** Suggestions de chaque session (JSON), pour savoir lesquelles ont changé. */
	const parSession = (): Map<string, string> => {
		const listes = new Map<string, string[]>();
		for (const s of visibles()) for (const session of s.sessions) listes.set(session, [...(listes.get(session) ?? []), `${s.fiche}\u0000${s.sessions.length}\u0000${s.jours}`]);
		return new Map([...listes].map(([session, l]) => [session, JSON.stringify(l)]));
	};

	const recalculer = (fiches: Iterable<string>): void => {
		for (const fiche of fiches) {
			const liste = parFiche.get(fiche) ?? [];
			if (liste.length === 0) {
				parFiche.delete(fiche);
				voix.delete(fiche);
			} else voix.set(fiche, voixDesGestes(liste));
		}
		suggestionsCalculees = suggestionsEcarteeToujours([...gestes.values()], ecartees, retablissements, jourLocal);
	};

	/** Le vecteur d'un message, partagé : le premier vu pour ce message, s'il est du même modèle et de la même dimension. */
	const vecteurPartage = (session: string, rangMessage: number, v: VecteurDApriori | null): VecteurDApriori | null => {
		if (v === null || rangMessage <= 0) return v;
		const cle = cleDuMessage(session, rangMessage);
		const deja = vecteurs.get(cle);
		if (deja !== undefined && deja.modele === v.modele && deja.valeurs.length === v.valeurs.length) return deja;
		const garde = { modele: v.modele, valeurs: v.valeurs };
		vecteurs.set(cle, garde);
		return garde;
	};

	const ajouter = (g: GesteNote): void => {
		// ni texte du message, ni note : seulement ce que l'a priori lit
		const garde: GesteGarde = {
			rang: g.rang,
			geste: g.geste,
			session: g.session,
			horodatageMs: g.horodatageMs,
			dossier: g.dossier,
			position: g.position,
			fiche: g.fiche,
			rangMessage: g.rangMessage,
			vecteur: vecteurPartage(g.session, g.rangMessage, g.vecteur),
		};
		gestes.set(g.rang, garde);
		parFiche.set(g.fiche, [...(parFiche.get(g.fiche) ?? []), garde]);
		dernierRang = Math.max(dernierRang, g.rang);
	};

	/** Hors horizon ou au-delà du nombre gardé : les plus anciens partent ; les vecteurs qui ne servent plus aussi. */
	const elaguer = (touchees: Set<string>): void => {
		const maintenant = horloge();
		const limite = maintenant - HORIZON_GESTES_MS;
		const tries = [...gestes.values()].sort((a, b) => a.horodatageMs - b.horodatageMs || a.rang - b.rang);
		const enTrop = Math.max(0, tries.length - gestesMax);
		let recents = 0;
		for (const [i, g] of tries.entries()) {
			if (i >= enTrop && g.horodatageMs >= limite) break;
			if (g.horodatageMs > maintenant - DEMI_VIE_GESTE_JOURS * JOUR_MS) recents++;
			gestes.delete(g.rang);
			touchees.add(g.fiche);
		}
		if (recents > 0 && !elagageSignale) {
			elagageSignale = true;
			options.journal?.(`a priori des gestes : ${recents} geste(s) de moins de ${DEMI_VIE_GESTE_JOURS} jours oublié(s) (plus de ${gestesMax} gestes gardés) ; signalé une seule fois.`);
		}
		for (const fiche of touchees) parFiche.set(fiche, (parFiche.get(fiche) ?? []).filter((g) => gestes.has(g.rang)));
		const utiles = new Set([...gestes.values()].map((g) => cleDuMessage(g.session, g.rangMessage)));
		for (const cle of vecteurs.keys()) if (!utiles.has(cle)) vecteurs.delete(cle);
	};

	const lire = async (lireEcartees: boolean): Promise<Set<string>> => {
		// tout est lu avant de toucher à quoi que ce soit : une lecture en échec laisse l'état tel qu'il était
		const relireEcartees = lireEcartees || !charge;
		const nouveaux = charge
			? await etat.gestes({ depuisRang: dernierRang + 1, limite: null })
			: await etat.gestes({ depuisMs: horloge() - HORIZON_GESTES_MS, limite: gestesMax });
		const lues: EcarteeToujours[] | null = relireEcartees ? await etat.ecarteesToujours() : null;
		const chemins = options.chemins === undefined ? undefined : await options.chemins().catch(() => null);

		const avant = parSession();
		const touchees = new Set<string>();
		for (const g of nouveaux) {
			if (gestes.has(g.rang)) continue;
			ajouter(g);
			touchees.add(g.fiche);
		}
		if (lues !== null) {
			ecartees = new Set(lues.filter((e) => e.retablieMs === null).map((e) => e.fiche));
			retablissements = new Map(lues.flatMap((e) => (e.retablieMs === null ? [] : [[e.fiche, e.retablieMs] as const])));
		}
		// index illisible : le filtre d'avant reste
		if (chemins !== undefined && chemins !== null) presentes = new Set(chemins);
		if (nouveaux.length > 0) elaguer(touchees);
		if (!charge) for (const fiche of parFiche.keys()) touchees.add(fiche);
		charge = true;
		if (touchees.size > 0 || lues !== null) recalculer(touchees);

		const apres = parSession();
		return new Set([...avant.keys(), ...apres.keys()].filter((session) => avant.get(session) !== apres.get(session)));
	};

	let enCours: Promise<Set<string>> | null = null;
	let suivante: { promesse: Promise<Set<string>>; ecartees: boolean } | null = null;
	const lancer = (lireEcartees: boolean): Promise<Set<string>> => {
		const p: Promise<Set<string>> = lire(lireEcartees).finally(() => {
			if (enCours === p) enCours = null;
		});
		enCours = p;
		return p;
	};

	return {
		actualiser(o = {}) {
			if (enCours === null) return lancer(o.ecartees === true);
			if (suivante !== null) {
				suivante.ecartees ||= o.ecartees === true;
				return suivante.promesse;
			}
			const attente: { promesse: Promise<Set<string>>; ecartees: boolean } = { promesse: Promise.resolve(new Set()), ecartees: o.ecartees === true };
			attente.promesse = enCours
				.catch(() => {})
				.then(() => {
					suivante = null;
					return lancer(attente.ecartees);
				});
			suivante = attente;
			return attente.promesse;
		},
		aprioris: (contexte) => aprioris(voix, contexte),
		suggestions: (session) => (session === undefined ? visibles() : visibles().filter((s) => s.sessions.includes(session))),
		ecarteesToujours: () => ecartees,
		exclusDefinitivement: (candidates) => sansEcarteesToujours(candidates, ecartees, idDe),
		oublierSession(session) {
			const touchees = new Set<string>();
			for (const g of gestes.values()) {
				if (g.session !== session || g.vecteur === null) continue;
				const sans = { ...g, vecteur: null };
				gestes.set(g.rang, sans);
				parFiche.set(g.fiche, (parFiche.get(g.fiche) ?? []).map((x) => (x.rang === g.rang ? sans : x)));
				touchees.add(g.fiche);
			}
			for (const cle of vecteurs.keys()) if (cle.startsWith(`${session}\u0000`)) vecteurs.delete(cle);
			if (touchees.size > 0) recalculer(touchees);
		},
		taille: () => ({ gestes: gestes.size, vecteurs: vecteurs.size }),
	};
}
