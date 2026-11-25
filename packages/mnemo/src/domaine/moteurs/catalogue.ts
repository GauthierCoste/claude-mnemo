import { IDS_MOTEURS, NOMS_MOTEURS } from '@mnemo/commun';
import type { IdMoteur } from './moteur.ts';

/**
 * Ce que Mnemo sait de chaque moteur sans charger son implémentation (aide de `mnemo`, `mnemo init`) : `nom` ; `optionInit` :
 * l'option de `mnemo init` qui le prépare (`--mcp` : Claude Code, toujours proposé) ; `facultatif` : `mnemo init` ne le touche
 * que sur son option.
 */
export type FicheDuMoteur = { nom: string; optionInit: string; facultatif: boolean };

export const CATALOGUE_MOTEURS: Readonly<Record<IdMoteur, FicheDuMoteur>> = {
	'claude-code': { nom: NOMS_MOTEURS['claude-code'], optionInit: '--mcp', facultatif: false },
	codex: { nom: NOMS_MOTEURS.codex, optionInit: '--codex', facultatif: true },
	'mistral-vibe': { nom: NOMS_MOTEURS['mistral-vibe'], optionInit: '--mistral', facultatif: true },
};

/** Les moteurs, dans l'ordre de `IDS_MOTEURS`, avec leur fiche. */
export const FICHES_MOTEURS: readonly (FicheDuMoteur & { id: IdMoteur })[] = IDS_MOTEURS.map((id) => ({ id, ...CATALOGUE_MOTEURS[id] }));
