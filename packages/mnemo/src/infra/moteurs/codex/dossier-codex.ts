import { join } from 'node:path';
import { texteOuAbsent } from '../../fichier-de-configuration.ts';
import { dossierDuMoteur } from '../dossier-du-moteur.ts';

/** Dossier de configuration de Codex : `$CODEX_HOME` s'il est un chemin absolu, sinon `~/.codex`. */
export const dossierCodex = (env: Record<string, string | undefined>): string => dossierDuMoteur(env, 'CODEX_HOME', '.codex');

/** `config.toml` de Codex : `$CODEX_HOME/config.toml`, sinon `~/.codex/config.toml`. */
export const cheminConfigCodex = (env: Record<string, string | undefined>): string => join(dossierCodex(env), 'config.toml');

/** Texte de `config.toml` de Codex, lu seulement (jamais écrit par Mnemo) ; null s'il n'existe pas ; une autre erreur remonte. */
export const lireConfigCodex = (env: Record<string, string | undefined>): Promise<string | null> => texteOuAbsent(cheminConfigCodex(env));
