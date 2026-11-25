import { OUTILS_MNEMO_PERMIS } from '../../../domaine/moteurs/outils-permis.ts';
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
	permissionRequest: 'arret',
	sessionEnd: 'fin',
};

/** Source d'un `sessionStart` de Copilot (`new`, `resume` ; mesuré) en source Mnemo. */
const SOURCES: Record<string, string> = { new: 'startup', resume: 'resume', startup: 'startup' };

/**
 * Entrée de Copilot (1.0.116, camelCase, mesuré : `sessionId`, `cwd`, `source`, `prompt`, `toolName`, `toolArgs` — un objet,
 * ou le patch en chaîne pour `apply_patch` —, `toolInput` de `permissionRequest`, `transcriptPath`, `reason`) ramenée à la
 * forme commune. `transcriptPath` (`…/events.jsonl`) donne la fenêtre de contexte.
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
	return champs;
}

/** Outils de Mnemo tels que `permissionRequest` les nomme (`mnemo/<outil>`, mesuré), permis d'avance par `--allow-tool`. */
const OUTILS_PERMIS = new Set(OUTILS_MNEMO_PERMIS.map((o) => `mnemo/${o}`));

/**
 * Arrêt d'après son entrée : `agentStop` est un arrêt ; `permissionRequest` (Copilot évalue la permission d'un outil) un
 * dialogue ouvert, sauf pour un outil de Mnemo permis d'avance : Copilot l'appelle aussi pour lui, sans rien afficher
 * (mesuré), et le dialogue tenu pour ouvert serait faux.
 */
function arretDe(champs: Record<string, unknown>, options: ReadonlySet<string>): 'notification' | 'stop' | null {
	if (!options.has('--notification')) return 'stop';
	return typeof champs.tool_name === 'string' && OUTILS_PERMIS.has(champs.tool_name) ? null : 'notification';
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
 * Sous le `timeoutSec` de chaque hook de `hooks/mnemo.json` (`HOOKS_COPILOT_CLI_INSTALLES`) : `outil` décide en 2 s, avant
 * les 3 s après lesquelles Copilot laisse passer l'outil ; `fin` en 1,4 s (la durée que Copilot laisse à `sessionEnd` n'est
 * pas mesurée).
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
	notifications: new Set(['permissionRequest']),
	raisonsIgnorees: new Set(['clear']),
	arret: arretDe,
	sortie: sortieDe,
	echeancesMs: ECHEANCES_MS,
	finIgnoreeSiVivante: true,
});
