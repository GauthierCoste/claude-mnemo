import type { TouchesDuMoteur } from '../moteur.ts';

/**
 * Touches de Claude Code. Échap ferme un dialogue (permission) : un seul, et seulement quand le dernier arrêt est une
 * `Notification` (deux Échap de suite ouvrent le retour arrière), suivi de 150 ms avant toute autre touche. Claude Code ne
 * lance pas `Stop` quand l'utilisateur interrompt (doc des hooks) : passé 1 s, le dialogue est tenu pour fermé. Arrêt :
 * Ctrl-U (efface ce que l'utilisateur avait commencé à taper), `/exit`, puis Entrée.
 */
export const TOUCHES_CLAUDE_CODE: TouchesDuMoteur = { echap: '\x1b', pauseApresEchapMs: 150, attenteApresEchapMs: 1000, arret: '\x15/exit', entree: '\r' };
