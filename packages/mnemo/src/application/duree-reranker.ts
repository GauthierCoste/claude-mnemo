/**
 * Durée du reranker, tenue en mémoire par le service (jamais écrite ; spec classement vivant § 3.6) : les dernières durées
 * mesurées des appels « injection » (le hook, l'appel de mesure lancé après lui, l'affinage), l'identité du serveur qu'elles
 * mesurent, et les appels en cours. L'estimation elle-même est dans `domaine/droite-des-durees.ts`.
 *
 * Le hook ne lance le reranker que si l'estimation est fiable, qu'elle tient dans son temps et qu'aucun autre appel du
 * reranker n'est en cours dans le service (il attendrait derrière). Le hook sans service n'a pas de mesure : pas de reranker.
 */
import { documentsQuiTiennent, dureeEstimee, estimationFiable, mesuresValables, MESURES_GARDEES, VALIDITE_MESURE_MS } from '../domaine/droite-des-durees.ts';
import type { MesureDuReranker } from '../domaine/droite-des-durees.ts';
import type { Reranker } from './ports.ts';

/** Un appel sans réponse qui a duré au moins son budget moins ce temps a été coupé par son échéance. */
const TOLERANCE_COUPE_MS = 5;

export type DureeDuReranker = {
	/** Note une durée mesurée ; `censuree` : appel coupé par son échéance (`ms` : son budget, une borne basse). */
	noter(mesure: { documents: number; ms: number; censuree?: boolean }): void;
	/** Durée estimée pour `documents`, marge comprise ; null si l'estimation n'est pas fiable. */
	estimer(documents: number): number | null;
	/** Assez de mesures récentes et complètes pour croire l'estimation (sinon, le hook fait mesurer le reranker après lui). */
	fiable(): boolean;
	/**
	 * Nombre de candidates à soumettre au hook (de 8 à 5, bornés par `disponibles`) dont l'estimation tient dans `restantMs` ;
	 * null si aucun ne tient, si l'estimation n'est pas fiable, ou si un appel du reranker est en cours dans le service.
	 */
	documentsAuHook(restantMs: number, disponibles: number): number | null;
	/** Appels du reranker en cours dans le service (toutes sortes : palette, hook, mesure, affinage). */
	enCours(): number;
	/** Identité du serveur du reranker (modèle, lancement) ; une autre que la dernière vue oublie toutes les mesures. */
	identifier(identite: string | null): void;
	/**
	 * Le reranker vu par le service : chaque appel est compté tant qu'il est en cours ; un appel « injection » est mesuré s'il
	 * rend une note par document, ou noté coupé s'il ne rend rien après avoir pris tout son budget. Jamais une enveloppe
	 * d'enveloppe : un reranker déjà enveloppé ici est rendu tel quel.
	 */
	envelopper(reranker: Reranker): Reranker;
};

export function dureeDuReranker(maintenant: () => number = Date.now): DureeDuReranker {
	let mesures: MesureDuReranker[] = [];
	let identite: string | null | undefined = undefined;
	let enCours = 0;
	const enveloppes = new WeakSet<Reranker>();
	const valables = () => mesuresValables(mesures, maintenant());
	const duree: DureeDuReranker = {
		noter({ documents, ms, censuree }) {
			if (!(documents > 0) || !Number.isFinite(ms) || ms < 0) return;
			const instantMs = maintenant();
			mesures.push({ documents, ms, instantMs, ...(censuree === true ? { censuree: true } : {}) });
			mesures = mesures.filter((m) => instantMs - m.instantMs <= VALIDITE_MESURE_MS).slice(-MESURES_GARDEES);
		},
		estimer: (documents) => dureeEstimee(valables(), documents),
		fiable: () => estimationFiable(valables()),
		documentsAuHook: (restantMs, disponibles) => (enCours > 0 ? null : documentsQuiTiennent(valables(), restantMs, disponibles)),
		enCours: () => enCours,
		identifier(nouvelle) {
			if (identite !== undefined && nouvelle !== identite) mesures = [];
			identite = nouvelle;
		},
		envelopper(reranker) {
			if (enveloppes.has(reranker)) return reranker;
			const enveloppe: Reranker = {
				async noter(requete, textes, options) {
					const mesuree = options.activite?.operation === 'injection' && textes.length > 0;
					const debut = maintenant();
					enCours++;
					try {
						const notes = await reranker.noter(requete, textes, options);
						const ms = maintenant() - debut;
						if (mesuree && notes !== null && notes.length === textes.length) duree.noter({ documents: textes.length, ms });
						else if (mesuree && notes === null && ms >= options.budgetMs - TOLERANCE_COUPE_MS) duree.noter({ documents: textes.length, ms: Math.max(ms, options.budgetMs), censuree: true });
						return notes;
					} finally {
						enCours--;
					}
				},
			};
			enveloppes.add(enveloppe);
			return enveloppe;
		},
	};
	return duree;
}
