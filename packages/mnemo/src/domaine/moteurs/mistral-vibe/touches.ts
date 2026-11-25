import type { TouchesDuMoteur } from '../moteur.ts';

/**
 * Touches de Mistral Vibe : comme Codex. Échap ferme un dialogue d'approbation (`notification` `approval_requested`), suivi de
 * 150 ms avant toute autre touche ; passé 1 s sans arrêt, le dialogue est tenu pour fermé. Arrêt : Ctrl-U (efface ce que
 * l'utilisateur avait commencé à taper), `/exit`, puis Entrée, à part (100 ms après), comme pour Codex.
 */
export const TOUCHES_MISTRAL_VIBE: TouchesDuMoteur = { echap: '\x1b', pauseApresEchapMs: 150, attenteApresEchapMs: 1000, arret: '\x15/exit', entree: '\r', pauseAvantEntreeMs: 100 };
