import { join } from 'node:path';
import { dossierDuMoteur } from '../dossier-du-moteur.ts';

/** Dossier de GitHub Copilot CLI : `$COPILOT_HOME` s'il est un chemin absolu, sinon `~/.copilot`. */
export const dossierCopilot = (env: Record<string, string | undefined>): string => dossierDuMoteur(env, 'COPILOT_HOME', '.copilot');

/** `mcp-config.json` de Copilot (serveurs MCP de l'utilisateur, pour tout le poste). */
export const cheminConfigMcpCopilot = (env: Record<string, string | undefined>): string => join(dossierCopilot(env), 'mcp-config.json');

/** `settings.json` de Copilot (lu seulement : `disabledMcpServers`). */
export const cheminReglagesCopilot = (env: Record<string, string | undefined>): string => join(dossierCopilot(env), 'settings.json');

/** `hooks/mnemo.json` : le fichier de hooks propre à Mnemo, lu par Copilot avec les autres `hooks/*.json`. */
export const cheminHooksCopilot = (env: Record<string, string | undefined>): string => join(dossierCopilot(env), 'hooks', 'mnemo.json');

/** Sessions de Copilot : `session-state/<id>/events.jsonl`. */
export const dossierSessionsCopilot = (racine: string): string => join(racine, 'session-state');
