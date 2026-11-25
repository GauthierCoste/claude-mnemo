import { refusDeVersion } from '../version.ts';

/** Plus ancienne version de Codex mesurée avec Mnemo (0.171.0-alpha.13). */
export const VERSION_MIN_CODEX = '0.171.0';

/** Motif de refus d'un Codex trop ancien ; null s'il est assez récent, ou si sa version est inconnue ou illisible (rien n'est empêché). */
export const refusDeVersionCodex = (version: string | null): string | null => refusDeVersion('Codex', VERSION_MIN_CODEX, version);
