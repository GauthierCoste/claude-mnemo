import { join } from 'node:path';
import { dossierDuMoteur } from '../dossier-du-moteur.ts';

/** Dossier de Mistral Vibe : `$VIBE_HOME` (`~/…` développé, comme Vibe le fait) s'il est un chemin absolu, sinon `~/.vibe`. */
export const dossierVibe = (env: Record<string, string | undefined>): string => dossierDuMoteur(env, 'VIBE_HOME', '.vibe', true);

/** `config.toml` de Mistral Vibe (déclaration MCP, modèles). */
export const cheminConfigVibe = (env: Record<string, string | undefined>): string => join(dossierVibe(env), 'config.toml');

/** `hooks.toml` de Mistral Vibe (hooks de l'utilisateur, pour tout le poste). */
export const cheminHooksToml = (env: Record<string, string | undefined>): string => join(dossierVibe(env), 'hooks.toml');
