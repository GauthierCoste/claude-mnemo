import { OUTILS_CLAUDE_CODE } from './claude-code/outils.ts';
import type { IdMoteur, OutilsDuMoteur } from './moteur.ts';

const OUTILS: Partial<Record<IdMoteur, OutilsDuMoteur>> = { 'claude-code': OUTILS_CLAUDE_CODE };

/** Outils du moteur ; null : ce moteur n'a pas encore d'implémentation. */
export function outilsDuMoteur(id: IdMoteur): OutilsDuMoteur | null {
	return OUTILS[id] ?? null;
}
