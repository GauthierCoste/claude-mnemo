import { OUTILS_CLAUDE_CODE } from './claude-code/outils.ts';
import { OUTILS_CODEX } from './codex/outils.ts';
import { OUTILS_COPILOT_CLI } from './copilot-cli/outils.ts';
import { OUTILS_MISTRAL_VIBE } from './mistral-vibe/outils.ts';
import type { IdMoteur, OutilsDuMoteur } from './moteur.ts';

const OUTILS: Readonly<Record<IdMoteur, OutilsDuMoteur>> = { 'claude-code': OUTILS_CLAUDE_CODE, codex: OUTILS_CODEX, 'mistral-vibe': OUTILS_MISTRAL_VIBE, 'copilot-cli': OUTILS_COPILOT_CLI };

/** Outils du moteur. */
export function outilsDuMoteur(id: IdMoteur): OutilsDuMoteur {
	return OUTILS[id];
}
