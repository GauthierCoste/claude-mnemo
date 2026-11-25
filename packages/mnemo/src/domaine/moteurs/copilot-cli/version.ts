import { refusDeVersion } from '../version.ts';

/** Version de GitHub Copilot CLI mesurée avec Mnemo (1.0.116 : `--session-id`, hooks en camelCase, `additionalContext`). */
export const VERSION_MIN_COPILOT_CLI = '1.0.116';

/** Motif de refus d'un GitHub Copilot CLI trop ancien ; null s'il est assez récent, ou si sa version est illisible (rien n'est empêché). */
export const refusDeVersionCopilotCli = (version: string | null): string | null => refusDeVersion('GitHub Copilot CLI', VERSION_MIN_COPILOT_CLI, version);
