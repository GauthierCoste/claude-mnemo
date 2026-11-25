import type { TouchesDuMoteur } from '../moteur.ts';

/**
 * Touches de GitHub Copilot CLI : comme Codex. Échap ferme un dialogue d'approbation (`permissionRequest`), suivi de 150 ms
 * avant toute autre touche ; passé 1 s sans arrêt, le dialogue est tenu pour fermé. Arrêt : Ctrl-U (efface ce que
 * l'utilisateur avait commencé à taper), `/exit` (mesuré : code 0, `sessionEnd` `user_exit`), puis Entrée, à part (100 ms
 * après), qui choisit `/exit` dans la liste des commandes qu'ouvre la barre oblique.
 */
export const TOUCHES_COPILOT_CLI: TouchesDuMoteur = { echap: '\x1b', pauseApresEchapMs: 150, attenteApresEchapMs: 1000, arret: '\x15/exit', entree: '\r', pauseAvantEntreeMs: 100 };
