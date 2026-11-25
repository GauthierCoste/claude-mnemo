import type { EvenementHook } from '../../../domaine/session.ts';
import type { ReponseHook } from '../../evenements.ts';
import type { HooksDuMoteur } from '../../ports.ts';
import { hooksGardes } from '../hooks-gardes.ts';

/** Événement Mnemo de l'argument : nom Mnemo (celui de `hooks.toml`) ou type de hook de Mistral Vibe. */
const EVENEMENTS: Record<string, EvenementHook> = {
	debut: 'debut',
	message: 'message',
	outil: 'outil',
	apres_outil: 'apres_outil',
	arret: 'arret',
	fin: 'fin',
	session_start: 'debut',
	pre_agent: 'message',
	pre_tool: 'outil',
	post_tool: 'apres_outil',
	post_agent: 'arret',
	notification: 'arret',
	session_end: 'fin',
};

/** Notifications qui montrent un dialogue (approbation d'un outil, question à l'utilisateur) ; un tour échoué rend la main. */
const DIALOGUES = new Set(['approval_requested', 'question_asked']);
const ARRETS = new Set(['turn_failed']);

/**
 * Arrêt d'après son entrée : `post_agent` (fin du tour de l'agent de la session) est un arrêt ; une `notification` est un
 * dialogue ouvert (`approval_requested`, `question_asked`), un arrêt (`turn_failed`), ou ignorée (`turn_completed` double
 * `post_agent`).
 */
function arretDe(champs: Record<string, unknown>, options: ReadonlySet<string>): 'notification' | 'stop' | null {
	if (!options.has('--notification')) return 'stop';
	const type = champs.notification_type;
	if (typeof type !== 'string') return null;
	return DIALOGUES.has(type) ? 'notification' : ARRETS.has(type) ? 'stop' : null;
}

/** Événements dont la sortie ajoute un contexte (`hook_specific_output.additional_context`). */
const AVEC_CONTEXTE = new Set<EvenementHook>(['debut', 'message', 'apres_outil']);

/**
 * Sortie de Mistral Vibe pour la réponse (code 0, JSON sur stdout ; lu et mesuré), ou « » : pour `outil`, `decision: "deny"` et
 * sa raison, que le modèle reçoit comme résultat de l'outil ; pour `debut`, `message` et `apres_outil`,
 * `hook_specific_output.additional_context` (ajouté au message suivant, au message, ou au résultat de l'outil).
 */
function sortieDe(evenement: EvenementHook, reponse: ReponseHook): string {
	if (evenement === 'outil') {
		const refus = reponse.refus;
		return refus === undefined || refus.trim() === '' ? '' : `${JSON.stringify({ decision: 'deny', reason: refus })}\n`;
	}
	const contexte = reponse.contexte;
	if (!AVEC_CONTEXTE.has(evenement) || contexte === undefined || contexte.trim() === '') return '';
	return `${JSON.stringify({ hook_specific_output: { additional_context: contexte } })}\n`;
}

/**
 * Sous le `timeout` de chaque hook dans `hooks.toml` (`HOOKS_MISTRAL_VIBE_INSTALLES`) ; `fin` : Vibe attend au plus 2 s, à la
 * fermeture, l'ensemble des hooks en cours (1,4 s, comme Claude Code).
 */
const ECHEANCES_MS: Record<EvenementHook, number> = { debut: 900, message: 900, outil: 2000, apres_outil: 900, arret: 900, fin: 1400 };

/**
 * Mistral Vibe : hooks installés pour tout le poste (`$VIBE_HOME/hooks.toml`), inertes hors d'une session Mistral Vibe de
 * Mnemo. Une fin `clear` (`/clear` : la conversation change dans le même processus) est ignorée ; une autre fin pendant que
 * le processus tourne aussi, la fin étant traitée à sa sortie.
 */
export const HOOKS_MISTRAL_VIBE: HooksDuMoteur = hooksGardes({
	moteur: 'mistral-vibe',
	evenements: EVENEMENTS,
	notifications: new Set(['notification']),
	raisonsIgnorees: new Set(['clear']),
	arret: arretDe,
	// approbation demandée par un sous-agent (`task`) : `parent_session_id` est la session (non mesuré)
	dialogueDuParent: true,
	// `post_tool` installé pour tous les outils : il efface le dialogue ouvert une fois l'outil approuvé passé
	apresOutilDEtat: true,
	sortie: sortieDe,
	echeancesMs: ECHEANCES_MS,
	finIgnoreeSiVivante: true,
});
