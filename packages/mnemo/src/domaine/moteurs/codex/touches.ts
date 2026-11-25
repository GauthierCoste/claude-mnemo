import type { TouchesDuMoteur } from '../moteur.ts';

/**
 * Touches de Codex. Échap ferme un dialogue d'approbation (`PermissionRequest`), suivi de 150 ms avant toute autre touche ;
 * passé 1 s sans `Stop`, le dialogue est tenu pour fermé (comme chez Claude Code). Arrêt (lot 0) : Ctrl-U (efface ce que
 * l'utilisateur avait commencé à taper), `/quit`, puis Entrée.
 */
export const TOUCHES_CODEX: TouchesDuMoteur = { echap: '\x1b', pauseApresEchapMs: 150, attenteApresEchapMs: 1000, arret: '\x15/quit', entree: '\r' };
