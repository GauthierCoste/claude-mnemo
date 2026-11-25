import { estObjet, objetJson } from '../../valeurs.ts';
import type { FenetreDeContexte } from '../moteur.ts';

/**
 * Fenêtre de contexte d'une session GitHub Copilot CLI (1.0.116), lue dans la fin de son journal
 * `session-state/<id>/events.jsonl` (une ligne `{ type, data, … }` par événement, mesuré) : le dernier `session.usage_record`
 * de l'agent de la session (`data.usage.interactionType` `conversation-agent`, ou absent), `utilises` = `inputTokens` +
 * `outputTokens` du dernier appel (si `inputTokens` compte les tokens en cache n'est pas mesuré), `max` = `maxPromptTokens`.
 * Les crédits (`aiCreditsStatus`, `cost`) ne disent aucun quota du compte : jamais lus.
 */

const nombre = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** Fenêtre d'un `usage` d'un appel de l'agent de la session ; null sinon. */
function fenetreDe(usage: unknown): FenetreDeContexte | null {
	if (!estObjet(usage)) return null;
	if (usage.interactionType !== undefined && usage.interactionType !== 'conversation-agent') return null;
	const entree = nombre(usage.inputTokens);
	const max = nombre(usage.maxPromptTokens);
	if (entree === null || max === null || max <= 0) return null;
	const utilises = entree + (nombre(usage.outputTokens) ?? 0);
	return utilises > 0 ? { utilises, max } : null;
}

/** Fenêtre d'après les lignes de la fin du journal ; null si aucune n'en donne. Une ligne illisible est ignorée. */
export function fenetreDansLeJournal(lignes: readonly string[]): FenetreDeContexte | null {
	for (let i = lignes.length - 1; i >= 0; i -= 1) {
		const ligne = lignes[i]!;
		if (!ligne.includes('"session.usage_record"')) continue;
		const evenement = objetJson(ligne);
		if (evenement?.['type'] !== 'session.usage_record' || !estObjet(evenement['data'])) continue;
		const fenetre = fenetreDe(evenement['data']['usage']);
		if (fenetre !== null) return fenetre;
	}
	return null;
}
