import { refusDeVersion } from '../version.ts';

/** Version de Mistral Vibe mesurée avec Mnemo (3.1.5 ; ses hooks datent de la 3.1.1). */
export const VERSION_MIN_MISTRAL_VIBE = '3.1.5';

/** Motif de refus d'un Mistral Vibe trop ancien ; null s'il est assez récent, ou si sa version est illisible (rien n'est empêché). */
export const refusDeVersionMistralVibe = (version: string | null): string | null => refusDeVersion('Mistral Vibe', VERSION_MIN_MISTRAL_VIBE, version);
