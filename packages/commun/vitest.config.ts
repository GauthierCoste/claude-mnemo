import { defineConfig } from 'vitest/config';
import { MAX_WORKERS } from '../../outils-tests/workers.ts';

// testTimeout : le parcours des sources construit le programme TypeScript de chaque paquet (plusieurs secondes).
export default defineConfig({
	test: {
		maxWorkers: MAX_WORKERS,
		include: ['tests/**/*.test.ts'],
		setupFiles: ['../../outils-tests/garde.ts'],
		testTimeout: 120_000,
	},
});
