import { IDS_MOTEURS, NOMS_MOTEURS } from '@mnemo/commun';
import type { IdMoteur } from './moteur.ts';

/**
 * Ce que Mnemo sait de chaque moteur sans charger son implémentation (aide de `mnemo`, hooks) :
 * - `nom` ; `optionInit` : l'option de `mnemo init` qui le prépare (`--mcp` : Claude Code, toujours proposé) ; `facultatif` :
 *   `mnemo init` ne le touche que sur son option ;
 * - `litLesHooksDeClaudeCode` : il exécute lui-même des hooks au format de Claude Code trouvés dans le dépôt (GitHub Copilot
 *   CLI : ceux de `.claude/settings.json` d'un dossier approuvé, noms et entrée de Claude Code ; mesuré) ; des hooks de Mnemo
 *   pour Claude Code y sont inertes dans une session de ce moteur.
 */
export type FicheDuMoteur = { nom: string; optionInit: string; facultatif: boolean; litLesHooksDeClaudeCode: boolean };

export const CATALOGUE_MOTEURS: Readonly<Record<IdMoteur, FicheDuMoteur>> = {
	'claude-code': { nom: NOMS_MOTEURS['claude-code'], optionInit: '--mcp', facultatif: false, litLesHooksDeClaudeCode: false },
	codex: { nom: NOMS_MOTEURS.codex, optionInit: '--codex', facultatif: true, litLesHooksDeClaudeCode: false },
	'mistral-vibe': { nom: NOMS_MOTEURS['mistral-vibe'], optionInit: '--mistral', facultatif: true, litLesHooksDeClaudeCode: false },
	'copilot-cli': { nom: NOMS_MOTEURS['copilot-cli'], optionInit: '--copilot', facultatif: true, litLesHooksDeClaudeCode: true },
};

/** Les moteurs, dans l'ordre de `IDS_MOTEURS`, avec leur fiche. */
export const FICHES_MOTEURS: readonly (FicheDuMoteur & { id: IdMoteur })[] = IDS_MOTEURS.map((id) => ({ id, ...CATALOGUE_MOTEURS[id] }));
