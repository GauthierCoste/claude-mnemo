import { CATALOGUE_MOTEURS } from '../../../domaine/moteurs/catalogue.ts';
import { estIdMoteur } from '../../../domaine/moteurs/moteur.ts';
import { estSourceDeDebut, estUuid } from '../../../domaine/session.ts';
import type { EvenementHook } from '../../../domaine/session.ts';
import { estObjet, objetJson } from '../../../domaine/valeurs.ts';
import type { EntreeHook, ReponseHook } from '../../evenements.ts';
import type { AppelHook, HooksDuMoteur } from '../../ports.ts';

/** Événement Mnemo de l'argument : nom Mnemo (celui du plugin assemblé) ou nom Claude Code. */
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
	Notification: 'arret',
	SessionEnd: 'fin',
};
/** Options permises après l'événement (celles du plugin assemblé), une fois chacune. */
const OPTIONS: Partial<Record<EvenementHook, readonly string[]>> = { arret: ['--notification'], debut: ['--sans-contexte'], message: ['--sans-contexte'], apres_outil: ['--sans-contexte'] };
/**
 * Notifications qui ne montrent aucun dialogue : `idle_prompt` (Claude attend un message depuis un moment, après un `Stop`)
 * compte comme un `Stop`. Les autres (`permission_prompt`, `elicitation_dialog`, type absent…) : un dialogue peut être ouvert.
 */
const NOTIFICATIONS_SANS_DIALOGUE = new Set(['idle_prompt']);

/** Nom Claude Code de la sortie, pour les événements qui ajoutent un contexte. */
const SORTIES: Partial<Record<EvenementHook, string>> = { debut: 'SessionStart', message: 'UserPromptSubmit', apres_outil: 'PostToolUse' };

/** `SessionEnd` de `/clear` ou d'un `/resume` interactif : la conversation change dans le même processus, la session Mnemo continue. */
const RAISONS_IGNOREES = new Set(['clear', 'resume']);

/**
 * Sortie de Claude Code pour la réponse, ou « » : `additionalContext` (`debut`, `message`) ; pour `outil`, le refus `PreToolUse`
 * documenté (https://code.claude.com/docs/en/hooks : code 0, `permissionDecisionReason` pour Claude, `systemMessage` pour l'utilisateur).
 */
export function sortieDe(evenement: EvenementHook, reponse: ReponseHook): string {
	if (evenement === 'outil') {
		const refus = reponse.refus;
		if (refus === undefined || refus.trim() === '') return '';
		return `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: refus }, systemMessage: refus })}\n`;
	}
	const nom = SORTIES[evenement];
	const contexte = reponse.contexte;
	if (nom === undefined || contexte === undefined || contexte.trim() === '') return '';
	return `${JSON.stringify({ hookSpecificOutput: { hookEventName: nom, additionalContext: contexte } })}\n`;
}

/**
 * Entrée de Claude Code traduite ; null si elle est à ignorer (`SessionEnd` de `/clear`) ou illisible hors `outil`, qui doit
 * rendre une décision : son action est alors « non lue ». Session : `MNEMO_SESSION`, sinon `session_id` ; « » sans uuid valide.
 */
function traduire({ evenement, options, lecture, env, maintenantMs, cwdProcessus, reel }: AppelHook): { entree: EntreeHook; transcription?: string } | null {
	const lu = 'texte' in lecture ? objetJson(lecture.texte) : null;
	if (lu === null && evenement !== 'outil') return null;
	const champs = lu ?? {};
	if (evenement === 'fin' && typeof champs.reason === 'string' && RAISONS_IGNOREES.has(champs.reason)) return null;
	const candidates = [env.MNEMO_SESSION, champs.session_id];
	const session = candidates.find((c): c is string => typeof c === 'string' && estUuid(c)) ?? '';
	// Claude Code lance le hook dans son dossier courant : la meilleure position connue quand l'entrée n'en donne pas
	const entree: EntreeHook = { evenement, session, horodatageMs: maintenantMs, cwd: reel(typeof champs.cwd === 'string' && champs.cwd !== '' ? champs.cwd : cwdProcessus) };
	if (typeof champs.prompt === 'string') entree.prompt = champs.prompt;
	if (evenement === 'debut' && estSourceDeDebut(champs.source)) entree.source = champs.source;
	if (typeof champs.tool_name === 'string') entree.outil = { nom: champs.tool_name, entree: estObjet(champs.tool_input) ? champs.tool_input : {} };
	else if (evenement === 'outil') entree.outil = { nonLue: 'nonLue' in lecture ? lecture.nonLue : 'entree_illisible' };
	if (evenement === 'arret') {
		const notification = options.has('--notification') && !(typeof champs.notification_type === 'string' && NOTIFICATIONS_SANS_DIALOGUE.has(champs.notification_type));
		entree.arret = notification ? 'notification' : 'stop';
	}
	if (options.has('--sans-contexte')) entree.sansContexte = true;
	// hors de l'entrée : le chemin de la transcription ne sert qu'à la jauge de la fenêtre de contexte, chez le service
	return typeof champs.transcript_path === 'string' && champs.transcript_path !== '' ? { entree, transcription: champs.transcript_path } : { entree };
}

/**
 * `<événement> [options]` : l'événement (nom Mnemo ou Claude Code), puis ses options permises, une fois chacune ; null sinon.
 * `Notification` (nom Claude Code) vaut `arret --notification`.
 */
function lireArguments(args: string[]): { evenement: EvenementHook; options: Set<string> } | null {
	const [nom, ...reste] = args;
	const evenement = nom === undefined ? undefined : EVENEMENTS[nom];
	if (evenement === undefined) return null;
	const options = new Set(reste);
	if (options.size !== reste.length || !reste.every((o) => (OPTIONS[evenement] ?? []).includes(o))) return null;
	if (nom === 'Notification') options.add('--notification');
	return { evenement, options };
}

/**
 * `fin` : sous les 1,5 s que Claude Code laisse à `SessionEnd` ; `outil` : 1 s de marge avant les 3 s du `timeout` du plugin ;
 * les autres sous leur `timeout` (voir `hooksJson`).
 */
const ECHEANCES_MS: Record<EvenementHook, number> = { debut: 900, message: 900, outil: 2000, apres_outil: 900, arret: 900, fin: 1400 };

/**
 * Claude Code n'appelle Mnemo que par le plugin d'une session Mnemo : jamais inerte, sauf dans une session d'un moteur qui
 * exécute lui-même des hooks au format de Claude Code (`MNEMO_MOTEUR`, `litLesHooksDeClaudeCode`) : des hooks de Mnemo
 * copiés dans un `.claude/settings.json` y feraient double emploi avec ceux du moteur, qui parlent déjà pour la session.
 */
export const HOOKS_CLAUDE_CODE: HooksDuMoteur = {
	lireArguments,
	inerte: (env) => estIdMoteur(env.MNEMO_MOTEUR) && CATALOGUE_MOTEURS[env.MNEMO_MOTEUR].litLesHooksDeClaudeCode,
	traduire,
	sortie: sortieDe,
	echeancesMs: ECHEANCES_MS,
	finIgnoreeSiVivante: false,
};
