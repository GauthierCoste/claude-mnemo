import type { MoteurDuPoste } from '../../application/ports.ts';
import { DECLARATION_MCP_CODEX } from './codex/declaration-mcp.ts';
import { HOOKS_DU_POSTE_CODEX } from './codex/hooks-json.ts';
import { trouverCodex } from './codex/trouver-codex.ts';

/**
 * Codex, pour l'instant seulement sur le poste : sa commande (`MNEMO_CODEX`, le PATH, puis ChatGPT.app), le serveur MCP
 * déclaré par `codex mcp` et les hooks de Mnemo dans `~/.codex/hooks.json` (leur traduction et ses outils sont dans
 * `hooksDuMoteur`, `outilsDuMoteur`). Ni préparation des sessions, ni télémétrie : ce n'est pas un `Moteur`, il n'est pas
 * dans `MOTEURS` et le pilote refuse de lancer une session Codex.
 */
export const MOTEUR_CODEX: MoteurDuPoste = {
	id: 'codex',
	nom: 'Codex',
	commandeParDefaut: 'codex',
	trouver: (env, plateforme) => trouverCodex(env, plateforme as NodeJS.Platform),
	declarationMcp: DECLARATION_MCP_CODEX,
	hooksDuPoste: HOOKS_DU_POSTE_CODEX,
};
