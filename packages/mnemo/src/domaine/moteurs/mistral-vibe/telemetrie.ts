import { estObjet, objetJson } from '../../valeurs.ts';
import type { FenetreDeContexte } from '../moteur.ts';

/**
 * Télémétrie d'une session Mistral Vibe 3.1.5, lue dans son dossier `logs/session/unified/<id>/` (format
 * `mistral.vibe.unified-session-store/v1`, mesuré) :
 * - tokens du dernier appel au modèle : `session.contextUsage` (`inputTokens`, `outputTokens`, `cachedInputTokens`,
 *   `totalTokens`), écrit dans les `projection_delta` du journal (`journal/<n>.jsonl`) et dans `projection-state.json` de la
 *   génération courante ; `utilises` = `totalTokens` (entrée et sortie du dernier appel ; si `inputTokens` comprend les tokens
 *   en cache n'est pas mesuré) ;
 * - taille de la fenêtre : `core_settings.context.model_facts.context_window` de `runtime-state.json` (celle que Vibe
 *   suppose quand le modèle ne la donne pas : 262 144).
 * Le quota du compte (`billing/budget`) n'est écrit nulle part : jamais lu.
 */

const nombre = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** Tokens d'un `contextUsage` ; null s'il est illisible. */
function tokensDe(usage: unknown): number | null {
	if (!estObjet(usage)) return null;
	const total = nombre(usage.totalTokens);
	if (total !== null) return total;
	const entree = nombre(usage.inputTokens);
	return entree === null ? null : entree + (nombre(usage.outputTokens) ?? 0);
}

/** Le dernier `contextUsage` de la valeur, en profondeur (ordre du texte) ; null s'il n'y en a pas de lisible. */
function dernierUsage(valeur: unknown, profondeur = 0): number | null {
	if (profondeur > 12) return null;
	let trouve: number | null = null;
	if (Array.isArray(valeur)) {
		for (const v of valeur) trouve = dernierUsage(v, profondeur + 1) ?? trouve;
		return trouve;
	}
	if (!estObjet(valeur)) return null;
	for (const [cle, v] of Object.entries(valeur)) trouve = (cle === 'contextUsage' ? tokensDe(v) : dernierUsage(v, profondeur + 1)) ?? trouve;
	return trouve;
}

/** Tokens du dernier appel, d'après les lignes d'un journal (la fin) ; null si aucune n'en porte. Une ligne illisible est ignorée. */
export function tokensDansLeJournal(lignes: readonly string[]): number | null {
	for (let i = lignes.length - 1; i >= 0; i -= 1) {
		const ligne = lignes[i]!;
		if (!ligne.includes('"contextUsage"')) continue;
		const lus = dernierUsage(objetJson(ligne));
		if (lus !== null) return lus;
	}
	return null;
}

/** Tokens du dernier appel d'après `projection-state.json` (`snapshot.session.contextUsage`) ; null sinon. */
export function tokensDansLaProjection(texte: string): number | null {
	const projection = objetJson(texte);
	const snapshot = projection?.['snapshot'];
	return estObjet(snapshot) && estObjet(snapshot.session) ? tokensDe(snapshot.session.contextUsage) : null;
}

/** Taille de la fenêtre d'après `runtime-state.json` ; null sinon. */
export function fenetreDansEtatDuMoteur(texte: string): number | null {
	const etat = objetJson(texte);
	const reglages = etat?.['core_settings'];
	const contexte = estObjet(reglages) ? reglages.context : undefined;
	const faits = estObjet(contexte) ? contexte.model_facts : undefined;
	const taille = estObjet(faits) ? nombre(faits.context_window) : null;
	return taille !== null && taille > 0 ? taille : null;
}

/** Fenêtre de contexte, si les deux sont connus et que des tokens sont utilisés. */
export function fenetreMistralVibe(utilises: number | null, max: number | null): FenetreDeContexte | null {
	return utilises === null || max === null || utilises <= 0 ? null : { utilises, max };
}

/** Génération courante (`CURRENT` : `{ "generation": "<n>" }`) : un nom de dossier sûr ; null sinon. */
export function generationCourante(texte: string): string | null {
	const generation = objetJson(texte)?.['generation'];
	return typeof generation === 'string' && /^\d{1,32}$/u.test(generation) ? generation : null;
}
