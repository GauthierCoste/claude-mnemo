import type { EvenementHook } from '../../../domaine/session.ts';
import type { ReponseHook } from '../../evenements.ts';
import type { HooksDuMoteur } from '../../ports.ts';
import { hooksGardes } from '../hooks-gardes.ts';

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

/** Nom Codex de la sortie, pour les événements qui ajoutent un contexte. */
const SORTIES: Partial<Record<EvenementHook, string>> = { debut: 'SessionStart', message: 'UserPromptSubmit', apres_outil: 'PostToolUse' };

/**
 * Sortie de Codex pour la réponse, ou « » : `hookSpecificOutput.additionalContext` (`debut`, `message`, `apres_outil`) ; pour
 * `outil`, `permissionDecision: "deny"` et sa raison, que le modèle rapporte (mesuré). Pas de `systemMessage` : Codex ne le
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
 * Sous le `timeout` de chaque hook dans `~/.codex/hooks.json` (`TIMEOUTS_CODEX_S`) : comme chez Claude Code, sauf `fin`, que
 * Codex borne à 3 s (`SessionEnd`) : 2,5 s, une demi-seconde de marge pour le démarrage de Node et la sortie.
 */
const ECHEANCES_MS: Record<EvenementHook, number> = { debut: 900, message: 900, outil: 2000, apres_outil: 900, arret: 900, fin: 2500 };

/**
 * Codex : hooks installés pour tout le poste (`~/.codex/hooks.json`), inertes hors d'une session Codex de Mnemo. Une fin
 * `clear` ou `resume` (conversation remplacée dans le même processus, par analogie avec Claude Code ; Codex 0.171 envoie
 * `other`) est ignorée.
 */
export const HOOKS_CODEX: HooksDuMoteur = hooksGardes({
	moteur: 'codex',
	evenements: EVENEMENTS,
	notifications: new Set(['PermissionRequest']),
	raisonsIgnorees: new Set(['clear', 'resume']),
	sortie: sortieDe,
	echeancesMs: ECHEANCES_MS,
	finIgnoreeSiVivante: true,
});
