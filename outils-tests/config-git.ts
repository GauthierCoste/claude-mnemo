/**
 * Fichier de configuration git « vide » des tests (GIT_CONFIG_GLOBAL, core.excludesFile), pour que la configuration git
 * de la machine n'influence aucun test.
 *
 * Sous Windows, `os.devNull` vaut `\\.\nul`, que git refuse (« unable to access '\\.\nul': Invalid argument ») : `git init`
 * échoue et, avec lui, tout test qui crée une mémoire. Un chemin inexistant convient partout, git lisant un fichier absent
 * comme vide ; on garde `/dev/null` ailleurs, où il marche déjà.
 */
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';

export const AUCUNE_CONFIG_GIT = process.platform === 'win32' ? join(tmpdir(), 'mnemo-tests-aucune-config-git-absente') : devNull;
