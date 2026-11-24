import { devNull } from 'node:os';
import { defineConfig } from 'vitest/config';
import { MAX_WORKERS } from '../outils-tests/workers.ts';

// Outils du dépôt (vérification de publication) : mêmes gardes que les paquets — HOME et dossier courant temporaires,
// variables de mémoire vidées, configuration git de la machine ignorée. Lancé par `pnpm test` à la racine.
export default defineConfig({
	root: import.meta.dirname,
	test: {
		maxWorkers: MAX_WORKERS,
		include: ['tests/**/*.test.ts'],
		setupFiles: ['../outils-tests/garde.ts'],
		env: {
			GIT_CONFIG_GLOBAL: devNull,
			GIT_CONFIG_NOSYSTEM: '1',
			GIT_CONFIG_COUNT: '1',
			GIT_CONFIG_KEY_0: 'core.excludesFile',
			GIT_CONFIG_VALUE_0: devNull,
		},
	},
});
