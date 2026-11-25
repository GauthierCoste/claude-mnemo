import { HOOKS_CLAUDE_CODE } from '../../application/moteurs/claude-code/hooks.ts';
import { assemblerPlugin, preparerClaudeCode } from '../../application/moteurs/claude-code/plugin.ts';
import type { Moteur } from '../../application/ports.ts';
import { OUTILS_CLAUDE_CODE } from '../../domaine/moteurs/claude-code/outils.ts';
import { quotasDeLimites } from '../../domaine/moteurs/claude-code/quotas.ts';
import { TOUCHES_CLAUDE_CODE } from '../../domaine/moteurs/claude-code/touches.ts';
import { fenetreDeTranscription } from './claude-code/fenetre-transcription.ts';
import { trouverClaude } from './claude-code/trouver-claude.ts';

/**
 * Claude Code : `claude` (`MNEMO_CLAUDE`, sinon le PATH), un plugin par session (hooks, réglages, consigne, skills), ses hooks
 * et ses outils, sa transcription (`~/.claude/projects/`) pour la fenêtre de contexte et sa ligne d'état pour les quotas.
 */
export const MOTEUR_CLAUDE_CODE: Moteur = {
	id: 'claude-code',
	nom: 'Claude Code',
	commandeParDefaut: 'claude',
	modeles: [],
	trouver: (env, plateforme) => trouverClaude(env, plateforme as NodeJS.Platform),
	fichiersDeSession: assemblerPlugin,
	preparer: preparerClaudeCode,
	touches: TOUCHES_CLAUDE_CODE,
	hooks: HOOKS_CLAUDE_CODE,
	outils: OUTILS_CLAUDE_CODE,
	telemetrie: { fenetre: fenetreDeTranscription(), quotas: quotasDeLimites },
};
