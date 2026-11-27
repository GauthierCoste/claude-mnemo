import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';
import { MAX_WORKERS } from '../../outils-tests/workers.ts';
import { AUCUNE_CONFIG_GIT } from '../../outils-tests/config-git.ts';

export default defineConfig({
	esbuild: { jsx: 'automatic' },
	// Mêmes gardes que packages/mnemo : aucun test ne lance le vrai `claude`, ne touche ~/.claude.json ni ne charge un vrai
	// modèle ; MNEMO_SANS_NAVIGATEUR : aucun service lancé par un test n'ouvre le navigateur ; MNEMO_PORT=0 : aucun ne prend
	// le port fixe (4747), peut-être celui de l'utilisateur ; GIT_CONFIG_* : la
	// configuration git de la machine (globale, système, ~/.config/git/ignore lu par défaut) n'influence aucun test ;
	// setupFiles : variables de mémoire vidées, HOME et dossier courant temporaires, échec si une vraie mémoire est trouvable.
	test: {
		maxWorkers: MAX_WORKERS,
		include: ['tests/**/*.test.{ts,tsx}'],
		setupFiles: ['../../outils-tests/garde.ts', './tests/aides/langue-francaise.ts'],
		environment: 'node',
		css: { modules: { classNameStrategy: 'non-scoped' } },
		env: {
			MNEMO_SANS_MCP: '1',
			MNEMO_SANS_NAVIGATEUR: '1',
			MNEMO_PORT: '0',
			MNEMO_MODELES: join(tmpdir(), 'mnemo-tests-aucun-modele'),
			MNEMO_CLAUDE: join(tmpdir(), 'mnemo-tests-aucun-claude'),
			GIT_CONFIG_GLOBAL: AUCUNE_CONFIG_GIT,
			GIT_CONFIG_NOSYSTEM: '1',
			GIT_CONFIG_COUNT: '1',
			GIT_CONFIG_KEY_0: 'core.excludesFile',
			GIT_CONFIG_VALUE_0: AUCUNE_CONFIG_GIT,
		},
	},
});
