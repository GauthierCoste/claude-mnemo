import type { Quota, Quotas } from '../../quotas.ts';
import { estObjet, objetJson } from '../../valeurs.ts';
import type { FenetreDeContexte } from '../moteur.ts';

/**
 * Télémétrie d'une session Codex, lue dans la fin de sa transcription (rollout, JSONL) : les événements
 * `{ type: "event_msg", payload: { type: "token_count", info, rate_limits } }` qui suivent chaque réponse du modèle.
 *
 * - Fenêtre : `info.last_token_usage` du dernier `token_count` qui en porte un ; `input_tokens` y comprend déjà
 *   `cached_input_tokens` (mesuré : `cached ≤ input` et `total_tokens = input_tokens + output_tokens`), d'où
 *   `utilises = input_tokens + output_tokens` sur `info.model_context_window`.
 * - Quotas de l'abonnement ChatGPT : `rate_limits.primary` et `secondary` (`used_percent`, `window_minutes`,
 *   `resets_at` en secondes) du dernier `token_count` qui en porte, relevés à son `timestamp`.
 */

/** Durées des fenêtres de quota (minutes) que Mnemo sait nommer, à une tolérance près ; une autre est ignorée. */
const CINQ_HEURES_MIN = 300;
const TOLERANCE_CINQ_HEURES_MIN = 5;
const SEMAINE_MIN = 7 * 24 * 60;
const TOLERANCE_SEMAINE_MIN = 30;

const nombre = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Fenêtre de contexte d'un `info` de `token_count` ; null si illisible ou vide. */
function fenetreDe(info: unknown): FenetreDeContexte | null {
	if (!estObjet(info) || !estObjet(info.last_token_usage)) return null;
	const max = nombre(info.model_context_window);
	const entree = nombre(info.last_token_usage.input_tokens);
	const sortie = nombre(info.last_token_usage.output_tokens) ?? 0;
	if (max === null || max <= 0 || entree === null || entree < 0 || sortie < 0) return null;
	const utilises = entree + sortie;
	return utilises > 0 ? { utilises, max } : null;
}

/** Une fenêtre de `rate_limits` et sa durée ; null si illisible. */
function quotaDe(fenetre: unknown): { minutes: number; quota: Quota } | null {
	if (!estObjet(fenetre)) return null;
	const part = nombre(fenetre.used_percent);
	const minutes = nombre(fenetre.window_minutes);
	const remise = nombre(fenetre.resets_at);
	if (part === null || minutes === null || remise === null || remise <= 0) return null;
	return { minutes, quota: { pourcentage: Math.min(100, Math.max(0, Math.round(part))), remiseMs: Math.round(remise * 1000) } };
}

/**
 * Quotas d'un `rate_limits` de Codex (ceux de l'abonnement, `limit_id` absent ou `codex`) : chaque fenêtre rangée selon sa
 * durée (5 heures à 5 min près, semaine à 30 min près), qu'elle soit `primary` ou `secondary` ; null s'il n'y en a aucune de lisible.
 */
export function quotasDeCodex(limites: unknown, releveMs?: number): Quotas | null {
	if (!estObjet(limites)) return null;
	if (limites.limit_id !== undefined && limites.limit_id !== null && limites.limit_id !== 'codex') return null;
	const quotas: Quotas = {};
	for (const brute of [limites.primary, limites.secondary]) {
		const lue = quotaDe(brute);
		if (lue === null) continue;
		if (Math.abs(lue.minutes - CINQ_HEURES_MIN) <= TOLERANCE_CINQ_HEURES_MIN) quotas.cinqHeures = lue.quota;
		else if (Math.abs(lue.minutes - SEMAINE_MIN) <= TOLERANCE_SEMAINE_MIN) quotas.semaine = lue.quota;
	}
	if (quotas.cinqHeures === undefined && quotas.semaine === undefined) return null;
	return releveMs === undefined ? quotas : { ...quotas, releveMs };
}

/**
 * Fenêtre et quotas d'après les derniers `token_count` des `lignes` (fin de transcription) ; chacun absent s'il n'y en a pas.
 * Une ligne illisible (la dernière, en cours d'écriture) est ignorée.
 */
export function telemetrieDeCodex(lignes: readonly string[]): { fenetre?: FenetreDeContexte; quotas?: Quotas } {
	let fenetre: FenetreDeContexte | null = null;
	let quotas: Quotas | null = null;
	for (let i = lignes.length - 1; i >= 0 && (fenetre === null || quotas === null); i -= 1) {
		const ligne = lignes[i]!;
		if (!ligne.includes('token_count')) continue;
		const objet = objetJson(ligne);
		if (objet === null || objet.type !== 'event_msg' || !estObjet(objet.payload) || objet.payload.type !== 'token_count') continue;
		fenetre ??= fenetreDe(objet.payload.info);
		if (quotas === null) {
			const instant = typeof objet.timestamp === 'string' ? Date.parse(objet.timestamp) : Number.NaN;
			quotas = quotasDeCodex(objet.payload.rate_limits, Number.isFinite(instant) ? instant : undefined);
		}
	}
	return { ...(fenetre === null ? {} : { fenetre }), ...(quotas === null ? {} : { quotas }) };
}
