// Durée du reranker estimée d'après ses dernières durées mesurées (spec classement vivant § 3.6). Pur : l'état (les mesures,
// l'identité du serveur, les appels en cours) est tenu par `application/duree-reranker.ts`.
//
// `durée(k) = fixe + k × par_document`, tirée des mesures par des médianes (pente de Theil-Sen : médiane des pentes entre deux
// mesures de tailles différentes ; fixe : médiane des restes) : une mesure aberrante ne la déplace pas. Plus une marge, doublée
// par chaque appel coupé par son échéance parmi les dernières mesures : une estimation trop optimiste se corrige d'elle-même.

import { mediane } from './signaux-de-note.ts';

/**
 * Une durée mesurée : `documents` notés en `ms`, à `instantMs`. `censuree` : l'appel a été coupé par son échéance ; `ms` est
 * alors son budget, une borne basse de la durée.
 */
export type MesureDuReranker = { documents: number; ms: number; instantMs: number; censuree?: boolean };

/** Au-delà, une mesure est oubliée : le serveur, la machine ou la mémoire ont pu changer. */
export const VALIDITE_MESURE_MS = 30 * 60_000;
/** Mesures gardées : les plus récentes. */
export const MESURES_GARDEES = 20;
/** Mesures complètes (non coupées) qu'il faut pour croire l'estimation. */
export const MESURES_MIN = 3;
/** Marge ajoutée à l'estimation : une part de la durée, plus un temps fixe. */
export const MARGE_RELATIVE = 0.2;
export const MARGE_MS = 10;
/** Un appel coupé parmi ces dernières mesures double la marge (au plus `FACTEUR_MAX`). */
export const MESURES_DE_LA_MARGE = 5;
export const FACTEUR_MAX = 8;
/** Candidates soumises au reranker au hook : le plus grand nombre de `max` à `min` qui tient. */
export const DOCUMENTS_AU_HOOK = { min: 5, max: 8 } as const;

/** Les mesures encore valables à `maintenantMs`, de la plus ancienne à la plus récente, au plus `MESURES_GARDEES`. */
export function mesuresValables(mesures: readonly MesureDuReranker[], maintenantMs: number): MesureDuReranker[] {
	return mesures
		.filter((m) => m.documents > 0 && Number.isFinite(m.ms) && m.ms >= 0 && maintenantMs - m.instantMs <= VALIDITE_MESURE_MS && m.instantMs <= maintenantMs)
		.sort((a, b) => a.instantMs - b.instantMs)
		.slice(-MESURES_GARDEES);
}

/**
 * `fixe` et `parDocument` (ms, ≥ 0) tirés des mesures complètes ; null sans elles. Avec une seule taille mesurée, la durée est
 * tenue pour proportionnelle au nombre de documents (fixe nul).
 */
export function droiteDesDurees(mesures: readonly Pick<MesureDuReranker, 'documents' | 'ms' | 'censuree'>[]): { fixe: number; parDocument: number } | null {
	const completes = mesures.filter((m) => m.censuree !== true && m.documents > 0 && Number.isFinite(m.ms) && m.ms >= 0);
	if (completes.length === 0) return null;
	const pentes: number[] = [];
	for (const [i, a] of completes.entries()) {
		for (const b of completes.slice(i + 1)) if (a.documents !== b.documents) pentes.push((b.ms - a.ms) / (b.documents - a.documents));
	}
	if (pentes.length === 0) return { fixe: 0, parDocument: Math.max(0, mediane(completes.map((m) => m.ms / m.documents))!) };
	const parDocument = Math.max(0, mediane(pentes)!);
	return { fixe: Math.max(0, mediane(completes.map((m) => m.ms - parDocument * m.documents))!), parDocument };
}

/** Facteur de la marge : 2 par appel coupé parmi les `MESURES_DE_LA_MARGE` dernières mesures, au plus `FACTEUR_MAX`. */
export function facteurDeMarge(valables: readonly MesureDuReranker[]): number {
	const coupees = valables.slice(-MESURES_DE_LA_MARGE).filter((m) => m.censuree === true).length;
	return Math.min(FACTEUR_MAX, 2 ** coupees);
}

/**
 * L'estimation est-elle fiable ? Au moins `MESURES_MIN` mesures complètes encore valables, et la dernière mesure n'est pas un
 * appel coupé (l'estimation vient de se montrer trop optimiste : il faut une nouvelle mesure complète).
 */
export function estimationFiable(valables: readonly MesureDuReranker[]): boolean {
	return valables.filter((m) => m.censuree !== true).length >= MESURES_MIN && valables.at(-1)?.censuree !== true;
}

/** Durée estimée pour `documents`, marge comprise ; null si l'estimation n'est pas fiable. */
export function dureeEstimee(valables: readonly MesureDuReranker[], documents: number): number | null {
	const droite = estimationFiable(valables) ? droiteDesDurees(valables) : null;
	return droite === null ? null : (droite.fixe + documents * droite.parDocument) * (1 + MARGE_RELATIVE) * facteurDeMarge(valables) + MARGE_MS;
}

/**
 * Nombre de candidates à soumettre au hook : le plus grand de `DOCUMENTS_AU_HOOK.max` à `.min` (bornés par `disponibles`) dont
 * l'estimation tient dans `restantMs` ; null si aucun ne tient, si l'estimation n'est pas fiable ou sans candidate.
 */
export function documentsQuiTiennent(valables: readonly MesureDuReranker[], restantMs: number, disponibles: number): number | null {
	const max = Math.min(DOCUMENTS_AU_HOOK.max, disponibles);
	const min = Math.min(DOCUMENTS_AU_HOOK.min, disponibles);
	for (let k = max; k >= min && k > 0; k--) {
		const ms = dureeEstimee(valables, k);
		if (ms === null) return null;
		if (ms <= restantMs) return k;
	}
	return null;
}
