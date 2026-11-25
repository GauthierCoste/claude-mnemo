import type { IdMoteur } from '../../domaine/moteurs/moteur.ts';
import type { HooksDuMoteur } from '../ports.ts';
import { HOOKS_CLAUDE_CODE } from './claude-code/hooks.ts';
import { HOOKS_CODEX } from './codex/hooks.ts';
import { HOOKS_MISTRAL_VIBE } from './mistral-vibe/hooks.ts';

const HOOKS: Partial<Record<IdMoteur, HooksDuMoteur>> = { 'claude-code': HOOKS_CLAUDE_CODE, codex: HOOKS_CODEX, 'mistral-vibe': HOOKS_MISTRAL_VIBE };

/**
 * Hooks du moteur, sans charger le reste de son implémentation (`mnemo hook` démarre à chaque événement : seuls ses modules
 * comptent dans son budget) ; null : ce moteur n'a pas encore d'implémentation.
 */
export function hooksDuMoteur(id: IdMoteur): HooksDuMoteur | null {
	return HOOKS[id] ?? null;
}
