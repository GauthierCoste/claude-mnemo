import type { EvenementHook } from '../../../domaine/session.ts';
import type { ReponseHook } from '../../evenements.ts';
import type { HooksDuMoteur } from '../../ports.ts';
import { hooksGardes } from '../hooks-gardes.ts';

/** Événement Mnemo de l'argument : nom Mnemo (celui de `hooks/mnemo.json`) ou événement de GitHub Copilot CLI. */
const EVENEMENTS: Record<string, EvenementHook> = {
	debut: 'debut',
	message: 'message',
	outil: 'outil',
	apres_outil: 'apres_outil',
	arret: 'arret',
	fin: 'fin',
	sessionStart: 'debut',
	userPromptSubmitted: 'message',
	preToolUse: 'outil',
	postToolUse: 'apres_outil',
	agentStop: 'arret',
	notification: 'arret',
	sessionEnd: 'fin',
};

/** Source d'un `sessionStart` de Copilot (`new`, `resume` ; mesuré) en source Mnemo. */
const SOURCES: Record<string, string> = { new: 'startup', resume: 'resume', startup: 'startup' };

/**
 * Entrée de Copilot (1.0.116, camelCase, mesuré : `sessionId`, `cwd`, `source`, `prompt`, `toolName`, `toolArgs` — un objet,
 * ou le patch en chaîne pour `apply_patch` —, `toolInput` de `permissionRequest`, `transcriptPath`, `reason` ; `notification`
 * en snake_case : `notification_type`, `message`, `title`) ramenée à la forme commune. `transcriptPath` (`…/events.jsonl`)
 * donne la fenêtre de contexte.
 */
function champsDe(lu: Record<string, unknown>): Record<string, unknown> {
	const champs: Record<string, unknown> = {};
	if (lu.sessionId !== undefined) champs.session_id = lu.sessionId;
	if (lu.cwd !== undefined) champs.cwd = lu.cwd;
	if (typeof lu.source === 'string' && Object.hasOwn(SOURCES, lu.source)) champs.source = SOURCES[lu.source];
	if (lu.prompt !== undefined) champs.prompt = lu.prompt;
	if (lu.toolName !== undefined) champs.tool_name = lu.toolName;
	const entree = lu.toolArgs ?? lu.toolInput;
	if (entree !== undefined) champs.tool_input = entree;
	if (lu.transcriptPath !== undefined) champs.transcript_path = lu.transcriptPath;
	if (lu.reason !== undefined) champs.reason = lu.reason;
	if (lu.notification_type !== undefined) champs.notification_type = lu.notification_type;
	return champs;
}

/**
 * Notifications qui montrent un dialogue : `permission_prompt` (mesuré : seulement quand la demande d'approbation s'affiche,
 * jamais pour un outil permis d'avance) ; `elicitation_dialog` (question d'un serveur MCP : nom lu dans les notes de version,
 * non mesuré). Les autres (fin d'un shell, de l'agent) sont ignorées.
 */
const DIALOGUES = new Set(['permission_prompt', 'elicitation_dialog']);

/**
 * Arrêt d'après son entrée : `agentStop` est un arrêt ; une `notification` de dialogue (`DIALOGUES`) un dialogue ouvert, effacé
 * par le `postToolUse` qui suit l'outil approuvé (installé sans `matcher`) ou par le message suivant. `permissionRequest` n'en
 * est pas un : Copilot l'appelle pour chaque outil dont il évalue la permission, affichée ou non (mesuré, même avec
 * `--allow-all-tools`) ; une commande `arret --notification` d'un `hooks/mnemo.json` d'avant, qui le reçoit, est ignorée (son
 * entrée n'a pas de `notification_type`).
 */
function arretDe(champs: Record<string, unknown>, options: ReadonlySet<string>): 'notification' | 'stop' | null {
	if (!options.has('--notification')) return 'stop';
	return typeof champs.notification_type === 'string' && DIALOGUES.has(champs.notification_type) ? 'notification' : null;
}

/** Événements dont la sortie ajoute un contexte : `additionalContext` au premier niveau (mesuré ; ailleurs, ignoré). */
const AVEC_CONTEXTE = new Set<EvenementHook>(['debut', 'message', 'apres_outil']);

/**
 * Sortie de Copilot pour la réponse (code 0, JSON sur stdout ; mesuré), ou « » : pour `outil`, `permissionDecision: "deny"` et
 * sa raison, que le modèle reçoit (« Denied by preToolUse hook: … ») ; pour `debut`, `message` et `apres_outil`,
 * `additionalContext`.
 */
function sortieDe(evenement: EvenementHook, reponse: ReponseHook): string {
	if (evenement === 'outil') {
		const refus = reponse.refus;
		return refus === undefined || refus.trim() === '' ? '' : `${JSON.stringify({ permissionDecision: 'deny', permissionDecisionReason: refus })}\n`;
	}
	const contexte = reponse.contexte;
	if (!AVEC_CONTEXTE.has(evenement) || contexte === undefined || contexte.trim() === '') return '';
	return `${JSON.stringify({ additionalContext: contexte })}\n`;
}

/**
 * Sous le `timeoutSec` de chaque hook de `hooks/mnemo.json` (`HOOKS_COPILOT_CLI_INSTALLES`) : `outil` décide en 2 s, bien
 * avant les 10 s après lesquelles Copilot laisse passer l'outil ; `fin` en 1,4 s (la durée que Copilot laisse à `sessionEnd`
 * n'est pas mesurée).
 */
const ECHEANCES_MS: Record<EvenementHook, number> = { debut: 900, message: 900, outil: 2000, apres_outil: 900, arret: 900, fin: 1400 };

/**
 * GitHub Copilot CLI : hooks installés pour tout le poste (`$COPILOT_HOME/hooks/mnemo.json`), inertes hors d'une session
 * GitHub Copilot CLI de Mnemo. Une fin `clear` serait ignorée (non mesuré) ; une fin pendant que le processus tourne aussi,
 * la fin étant traitée à sa sortie.
 */
export const HOOKS_COPILOT_CLI: HooksDuMoteur = hooksGardes({
	moteur: 'copilot-cli',
	champs: champsDe,
	evenements: EVENEMENTS,
	notifications: new Set(['notification']),
	raisonsIgnorees: new Set(['clear']),
	arret: arretDe,
	apresOutilDEtat: true,
	sortie: sortieDe,
	echeancesMs: ECHEANCES_MS,
	finIgnoreeSiVivante: true,
});
