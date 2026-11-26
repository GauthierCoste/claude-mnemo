import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';
import { AUCUNE_CONFIG_GIT } from '../../outils-tests/config-git.ts';
import { MAX_WORKERS } from '../../outils-tests/workers.ts';

// Mêmes gardes que packages/mnemo (les tests de l'infra lancent le vrai service) : aucun vrai `claude`, aucun modèle, aucun
// navigateur, aucun port fixe, aucune configuration git de la machine ; HOME et dossier courant temporaires (setupFiles).
// ELECTRON_OVERRIDE_DIST_PATH : un `import 'electron'` égaré sous Node ne télécharge jamais le binaire (le module
// `electron` le télécharge à son premier chargement) ; aucun test ne lance Electron.
export default defineConfig({
	test: {
		maxWorkers: MAX_WORKERS,
		include: ['tests/**/*.test.ts'],
		setupFiles: ['../../outils-tests/garde.ts'],
		env: {
			MNEMO_SANS_MCP: '1',
			MNEMO_SANS_NAVIGATEUR: '1',
			MNEMO_PORT: '0',
			MNEMO_MODELES: join(tmpdir(), 'mnemo-tests-aucun-modele'),
			MNEMO_CLAUDE: join(tmpdir(), 'mnemo-tests-aucun-claude'),
			ELECTRON_OVERRIDE_DIST_PATH: join(tmpdir(), 'mnemo-tests-aucun-electron'),
			GIT_CONFIG_GLOBAL: AUCUNE_CONFIG_GIT,
			GIT_CONFIG_NOSYSTEM: '1',
			GIT_CONFIG_COUNT: '1',
			GIT_CONFIG_KEY_0: 'core.excludesFile',
			GIT_CONFIG_VALUE_0: AUCUNE_CONFIG_GIT,
		},
	},
});
