import type { TouchesDuMoteur } from '../moteur.ts';

/**
 * Touches de Codex. Échap ferme un dialogue d'approbation (`PermissionRequest`), suivi de 150 ms avant toute autre touche ;
 * passé 1 s sans `Stop`, le dialogue est tenu pour fermé (comme chez Claude Code). Arrêt (mesuré) : Ctrl-U (efface ce que
 * l'utilisateur avait commencé à taper), `/quit`, puis Entrée. Une ligne tapée d'un bloc avec son Entrée n'est pas envoyée
 * (mesuré : la rafale est prise pour un collage) ; l'Entrée seule, 100 ms après, l'envoie.
 */
export const TOUCHES_CODEX: TouchesDuMoteur = { echap: '\x1b', pauseApresEchapMs: 150, attenteApresEchapMs: 1000, arret: '\x15/quit', entree: '\r', pauseAvantEntreeMs: 100 };
