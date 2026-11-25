import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';
import { MAX_WORKERS } from '../../outils-tests/workers.ts';
import { AUCUNE_CONFIG_GIT } from '../../outils-tests/config-git.ts';
import { TOLERANCE } from './tests/aides/charge.ts';

export default defineConfig({
	// MNEMO_SANS_MCP : `mnemo init` lancé par les tests ne doit jamais appeler le vrai `claude` (il modifierait ~/.claude.json).
	// MNEMO_MODELES : un dossier de modèles vide, pour qu'aucun test ne lance le vrai modèle de sens installé sur la machine.
	// MNEMO_CLAUDE : un chemin inexistant, pour qu'aucun test ne lance le vrai `claude` (les tests de sessions le pointent vers le faux).
	// MNEMO_CODEX : de même pour `codex` (sa configuration, ~/.codex/config.toml, n'est jamais lue ni touchée) ; MNEMO_VIBE : pour `vibe`.
	// MNEMO_SANS_NAVIGATEUR : `mnemo` lancé par les tests n'ouvre jamais le navigateur.
	// MNEMO_PORT : 0, un port libre ; aucun service de test ne prend le port fixe (4747), peut-être celui de l'utilisateur.
	// GIT_CONFIG_* : la configuration git de la machine n'influence aucun test (ni configuration globale ou système, ni le
	// fichier d'exclusions lu par défaut, ~/.config/git/ignore, qui peut ignorer .DS_Store).
	// setupFiles : chaque fichier de test tourne sans MNEMO_RACINE, MNEMO_SESSION, MNEMO_PROJET, CLAUDE_PROJECT_DIR, CODEX_HOME ni VIBE_HOME, avec
	// HOME et le dossier courant dans un dossier temporaire ; la suite échoue si une vraie mémoire reste trouvable.
	// testTimeout : 5 s, ×3 sur une machine chargée (`CI` ou `MNEMO_TESTS_LENTS=1`, voir tests/aides/charge.ts).
	test: {
		maxWorkers: MAX_WORKERS,
		include: ['tests/**/*.test.ts'],
		setupFiles: ['../../outils-tests/garde.ts'],
		testTimeout: 5000 * TOLERANCE,
		env: {
			MNEMO_SANS_MCP: '1',
			MNEMO_SANS_NAVIGATEUR: '1',
			MNEMO_PORT: '0',
			MNEMO_MODELES: join(tmpdir(), 'mnemo-tests-aucun-modele'),
			MNEMO_CLAUDE: join(tmpdir(), 'mnemo-tests-aucun-claude'),
			MNEMO_CODEX: join(tmpdir(), 'mnemo-tests-aucun-codex'),
			MNEMO_VIBE: join(tmpdir(), 'mnemo-tests-aucun-vibe'),
			GIT_CONFIG_GLOBAL: AUCUNE_CONFIG_GIT,
			GIT_CONFIG_NOSYSTEM: '1',
			GIT_CONFIG_COUNT: '1',
			GIT_CONFIG_KEY_0: 'core.excludesFile',
			GIT_CONFIG_VALUE_0: AUCUNE_CONFIG_GIT,
		},
	},
});
