/**
 * Durée du reranker, estimée d'après ses dernières durées mesurées (spec classement vivant § 3.6) : le hook ne le lance sur les
 * premières candidates que si l'estimation tient dans le temps qui lui reste. Tenue en mémoire par le service (jamais écrite) :
 * le hook sans service n'a pas de mesure, donc pas de reranker.
 *
 * Estimation : `durée(k) = fixe + k × par_document`, tirée des `MESURES_GARDEES` dernières mesures par des médianes (pente de
 * Theil-Sen : médiane des pentes entre deux mesures de tailles différentes ; fixe : médiane des restes). Une mesure aberrante
 * (modèle qui démarre, serveur occupé) ne la déplace pas. Plus une marge (`MARGE_RELATIVE`, `MARGE_MS`).
 */
import type { Reranker } from './ports.ts';

/** Une durée mesurée : `documents` notés en `ms`. */
export type MesureDuReranker = { documents: number; ms: number };

/** Mesures gardées : les plus récentes. */
export const MESURES_GARDEES = 20;
/** Marge ajoutée à l'estimation : une part de la durée, plus un temps fixe. */
export const MARGE_RELATIVE = 0.2;
export const MARGE_MS = 10;
/** Candidates soumises au reranker au hook : le plus grand nombre de `max` à `min` qui tient. */
export const DOCUMENTS_AU_HOOK = { min: 5, max: 8 } as const;

function mediane(valeurs: readonly number[]): number {
	const triees = [...valeurs].sort((a, b) => a - b);
	const m = Math.floor(triees.length / 2);
	return triees.length % 2 === 1 ? triees[m]! : (triees[m - 1]! + triees[m]!) / 2;
}

/**
 * `fixe` et `parDocument` (ms, ≥ 0) tirés des mesures ; null sans mesure. Avec une seule taille mesurée, la durée est tenue
 * pour proportionnelle au nombre de documents (fixe nul).
 */
export function droiteDesDurees(mesures: readonly MesureDuReranker[]): { fixe: number; parDocument: number } | null {
	const valides = mesures.filter((m) => m.documents > 0 && Number.isFinite(m.ms) && m.ms >= 0);
	if (valides.length === 0) return null;
	const pentes: number[] = [];
	for (const [i, a] of valides.entries()) {
		for (const b of valides.slice(i + 1)) if (a.documents !== b.documents) pentes.push((b.ms - a.ms) / (b.documents - a.documents));
	}
	if (pentes.length === 0) return { fixe: 0, parDocument: Math.max(0, mediane(valides.map((m) => m.ms / m.documents))) };
	const parDocument = Math.max(0, mediane(pentes));
	return { fixe: Math.max(0, mediane(valides.map((m) => m.ms - parDocument * m.documents))), parDocument };
}

export type DureeDuReranker = {
	/** Note une durée mesurée (un appel qui a rendu une note par document). */
	noter(documents: number, ms: number): void;
	/** Durée estimée pour `documents`, marge comprise ; null sans mesure. */
	estimer(documents: number): number | null;
	/**
	 * Nombre de candidates à soumettre au hook : le plus grand de `DOCUMENTS_AU_HOOK.max` à `.min` (bornés par `disponibles`) dont
	 * l'estimation tient dans `restantMs` ; null si aucun ne tient, sans mesure ou sans candidate.
	 */
	documentsAuHook(restantMs: number, disponibles: number): number | null;
};

export function dureeDuReranker(): DureeDuReranker {
	const mesures: MesureDuReranker[] = [];
	const estimer = (documents: number): number | null => {
		const droite = droiteDesDurees(mesures);
		return droite === null ? null : (droite.fixe + documents * droite.parDocument) * (1 + MARGE_RELATIVE) + MARGE_MS;
	};
	return {
		noter(documents, ms) {
			if (!(documents > 0) || !Number.isFinite(ms) || ms < 0) return;
			mesures.push({ documents, ms });
			if (mesures.length > MESURES_GARDEES) mesures.splice(0, mesures.length - MESURES_GARDEES);
		},
		estimer,
		documentsAuHook(restantMs, disponibles) {
			const max = Math.min(DOCUMENTS_AU_HOOK.max, disponibles);
			const min = Math.min(DOCUMENTS_AU_HOOK.min, disponibles);
			for (let k = max; k >= min && k > 0; k--) {
				const ms = estimer(k);
				if (ms === null) return null;
				if (ms <= restantMs) return k;
			}
			return null;
		},
	};
}

/**
 * Le reranker, dont chaque appel qui rend une note par document est mesuré (`duree.noter`) : outil `contexte`, recherche, hook.
 * Un appel sans réponse (modèle arrêté, délai dépassé, erreur) ne mesure rien : sa durée ne dit rien de celle d'une notation.
 */
export function rerankerMesure(reranker: Reranker, duree: DureeDuReranker, maintenant: () => number = Date.now): Reranker {
	return {
		async noter(requete, textes, options) {
			const debut = maintenant();
			const notes = await reranker.noter(requete, textes, options);
			if (notes !== null && textes.length > 0 && notes.length === textes.length) duree.noter(textes.length, maintenant() - debut);
			return notes;
		},
	};
}
