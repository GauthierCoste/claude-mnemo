/**
 * Remplissage de la fenêtre de contexte d'une session Claude Code, lu dans sa transcription : l'usage de la dernière réponse
 * de Claude (hors sous-agents) dit combien de tokens la conversation occupe.
 */

/** Fenêtre de contexte de Claude Code par défaut ; au-delà, la session tourne sur une fenêtre d'un million de tokens. */
export const FENETRE_STANDARD = 200_000;
export const FENETRE_ETENDUE = 1_000_000;

/** `avantResume` : le maximum est le seuil de résumé automatique de Claude Code, non la taille de la fenêtre. */
export type FenetreDeContexte = { utilises: number; max: number; avantResume?: true };

type Usage = { input_tokens?: unknown; cache_creation_input_tokens?: unknown; cache_read_input_tokens?: unknown; output_tokens?: unknown };

const nombre = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** Tokens occupés après une réponse : son entrée (cache compris) et sa sortie, qui entre dans le tour suivant. */
function tokensDe(usage: Usage): number {
	return nombre(usage.input_tokens) + nombre(usage.cache_creation_input_tokens) + nombre(usage.cache_read_input_tokens) + nombre(usage.output_tokens);
}

/**
 * La fenêtre d'après la dernière réponse de Claude des `lignes` (fin de transcription, JSONL) ; null s'il n'y en a pas. Avec un
 * `seuil` de résumé automatique (réglage `autoCompactWindow` de Claude Code, nombre fini > 0), il devient le maximum, même dépassé.
 */
export function fenetreDeContexte(lignes: readonly string[], seuil?: number): FenetreDeContexte | null {
	for (let i = lignes.length - 1; i >= 0; i -= 1) {
		let objet: { type?: unknown; isSidechain?: unknown; message?: { usage?: Usage } };
		try {
			objet = JSON.parse(lignes[i]!);
		} catch {
			continue;
		}
		if (objet.type !== 'assistant' || objet.isSidechain === true || objet.message?.usage === undefined) continue;
		const utilises = tokensDe(objet.message.usage);
		if (utilises === 0) continue;
		if (typeof seuil === 'number' && Number.isFinite(seuil) && seuil > 0) return { utilises, max: seuil, avantResume: true };
		return { utilises, max: utilises > FENETRE_STANDARD ? FENETRE_ETENDUE : FENETRE_STANDARD };
	}
	return null;
}
