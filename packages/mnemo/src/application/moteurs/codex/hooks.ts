import { estSourceDeDebut, estUuid } from '../../../domaine/session.ts';
import type { EvenementHook } from '../../../domaine/session.ts';
import { estObjet, objetJson } from '../../../domaine/valeurs.ts';
import type { EntreeHook, ReponseHook } from '../../evenements.ts';
import type { AppelHook, HooksDuMoteur } from '../../ports.ts';

/**
 * Événement Mnemo de l'argument : nom Mnemo (celui de `~/.codex/hooks.json`) ou nom Codex. `PermissionRequest` (Codex
 * demande une approbation : un dialogue est ouvert) est l'équivalent de `Notification` chez Claude Code.
 */
const EVENEMENTS: Record<string, EvenementHook> = {
	debut: 'debut',
	message: 'message',
	outil: 'outil',
	apres_outil: 'apres_outil',
	arret: 'arret',
	fin: 'fin',
	SessionStart: 'debut',
	UserPromptSubmit: 'message',
	PreToolUse: 'outil',
	PostToolUse: 'apres_outil',
	Stop: 'arret',
	PermissionRequest: 'arret',
	SessionEnd: 'fin',
};
/** Options permises après l'événement, une fois chacune (celles de Claude Code). */
const OPTIONS: Partial<Record<EvenementHook, readonly string[]>> = { arret: ['--notification'], debut: ['--sans-contexte'], message: ['--sans-contexte'], apres_outil: ['--sans-contexte'] };

/** Nom Codex de la sortie, pour les événements qui ajoutent un contexte. */
const SORTIES: Partial<Record<EvenementHook, string>> = { debut: 'SessionStart', message: 'UserPromptSubmit', apres_outil: 'PostToolUse' };

/** `SessionEnd` d'une conversation remplacée dans le même processus (par analogie avec Claude Code ; Codex 0.171 envoie `other`). */
const RAISONS_IGNOREES = new Set(['clear', 'resume']);

/** Identifiant de la session chez Codex : borné comme l'accepte le service. */
const FIL_MAX = 200;

/**
 * La session Mnemo de ce processus, ou null : `MNEMO_SESSION` et `MNEMO_MOTEUR=codex`, posées par Mnemo au lancement de Codex.
 * `MNEMO_SESSION` seule ne suffit pas : tout processus lancé depuis une session Claude Code en hérite (avec
 * `MNEMO_MOTEUR=claude-code`), un `codex` lancé par l'agent compris.
 */
function sessionMnemo(env: Record<string, string | undefined>): string | null {
	const session = env.MNEMO_SESSION;
	return env.MNEMO_MOTEUR === 'codex' && session !== undefined && estUuid(session) ? session : null;
}

/**
 * Sortie de Codex pour la réponse, ou « » : `hookSpecificOutput.additionalContext` (`debut`, `message`, `apres_outil`) ; pour
 * `outil`, `permissionDecision: "deny"` et sa raison, que le modèle rapporte (lot 0). Pas de `systemMessage` : Codex ne le
 * documente pas pour `PreToolUse`.
 */
function sortieDe(evenement: EvenementHook, reponse: ReponseHook): string {
	if (evenement === 'outil') {
		const refus = reponse.refus;
		if (refus === undefined || refus.trim() === '') return '';
		return `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: refus } })}\n`;
	}
	const nom = SORTIES[evenement];
	const contexte = reponse.contexte;
	if (nom === undefined || contexte === undefined || contexte.trim() === '') return '';
	return `${JSON.stringify({ hookSpecificOutput: { hookEventName: nom, additionalContext: contexte } })}\n`;
}

/**
 * Entrée de Codex traduite (lot 0 : `session_id`, `transcript_path`, `cwd`, `hook_event_name`, puis `source`, `prompt`,
 * `tool_name`, `tool_input`, `reason`…). Session : `MNEMO_SESSION` seulement — le `session_id` de Codex est son propre
 * identifiant (`fil`), jamais celui de la session Mnemo. Null hors d'une session Mnemo, pour un `SessionEnd` ignoré, ou
 * une entrée illisible hors `outil` (qui doit décider : son action est alors « non lue »).
 */
function traduire({ evenement, options, lecture, env, maintenantMs, cwdProcessus, reel }: AppelHook): { entree: EntreeHook; transcription?: string } | null {
	const session = sessionMnemo(env);
	if (session === null) return null;
	const lu = 'texte' in lecture ? objetJson(lecture.texte) : null;
	if (lu === null && evenement !== 'outil') return null;
	const champs = lu ?? {};
	if (evenement === 'fin' && typeof champs.reason === 'string' && RAISONS_IGNOREES.has(champs.reason)) return null;
	// Codex lance le hook dans le dossier de la session : la meilleure position connue quand l'entrée n'en donne pas
	const entree: EntreeHook = { evenement, session, horodatageMs: maintenantMs, cwd: reel(typeof champs.cwd === 'string' && champs.cwd !== '' ? champs.cwd : cwdProcessus) };
	if (typeof champs.session_id === 'string' && champs.session_id !== '' && champs.session_id.length <= FIL_MAX) entree.fil = champs.session_id;
	if (typeof champs.prompt === 'string') entree.prompt = champs.prompt;
	if (evenement === 'debut' && estSourceDeDebut(champs.source)) entree.source = champs.source;
	// une entrée d'outil en texte (patch brut) est gardée sous `input`, où les outils de Codex la lisent
	if (typeof champs.tool_name === 'string') entree.outil = { nom: champs.tool_name, entree: estObjet(champs.tool_input) ? champs.tool_input : typeof champs.tool_input === 'string' ? { input: champs.tool_input } : {} };
	else if (evenement === 'outil') entree.outil = { nonLue: 'nonLue' in lecture ? lecture.nonLue : 'entree_illisible' };
	if (evenement === 'arret') entree.arret = options.has('--notification') ? 'notification' : 'stop';
	if (options.has('--sans-contexte')) entree.sansContexte = true;
	return typeof champs.transcript_path === 'string' && champs.transcript_path !== '' ? { entree, transcription: champs.transcript_path } : { entree };
}

/** `<événement> [options]` : nom Mnemo ou Codex, puis ses options permises, une fois chacune ; `PermissionRequest` vaut `arret --notification`. */
function lireArguments(args: string[]): { evenement: EvenementHook; options: Set<string> } | null {
	const [nom, ...reste] = args;
	const evenement = nom === undefined || !Object.hasOwn(EVENEMENTS, nom) ? undefined : EVENEMENTS[nom];
	if (evenement === undefined) return null;
	const options = new Set(reste);
	if (options.size !== reste.length || !reste.every((o) => (OPTIONS[evenement] ?? []).includes(o))) return null;
	if (nom === 'PermissionRequest') options.add('--notification');
	return { evenement, options };
}

/**
 * Sous le `timeout` de chaque hook dans `~/.codex/hooks.json` (`TIMEOUTS_CODEX_S`) : comme chez Claude Code, sauf `fin`, que
 * Codex borne à 3 s (`SessionEnd`) : 2,5 s, une demi-seconde de marge pour le démarrage de Node et la sortie.
 */
const ECHEANCES_MS: Record<EvenementHook, number> = { debut: 900, message: 900, outil: 2000, apres_outil: 900, arret: 900, fin: 2500 };

/** Codex : hooks installés pour tout le poste, inertes hors d'une session Codex de Mnemo (`sessionMnemo`). */
export const HOOKS_CODEX: HooksDuMoteur = { lireArguments, inerte: (env) => sessionMnemo(env) === null, traduire, sortie: sortieDe, echeancesMs: ECHEANCES_MS };
