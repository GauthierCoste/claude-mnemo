import type { LectureHooksDuPoste } from '../ports.ts';

/** Ce qu'une session perd quand les hooks de son moteur ne s'exécutent pas. */
const PERTE = 'cette session ne transmettra rien à Mnemo (état, contexte servi, consignes vérifiées, épisode)';

/**
 * Avertissement d'une session dont le moteur prend les hooks de Mnemo installés pour tout le poste (Codex) : hooks absents,
 * d'une autre installation, illisibles, ou pas approuvés chez le moteur. La session se lance quand même ; null : rien à
 * signaler (approbation lue, ou impossible à vérifier : `verifier-poste` le dit).
 */
export function avertissementDesHooks(nom: string, id: string, lu: LectureHooksDuPoste): string | null {
	if ('echec' in lu) return `Hooks de Mnemo pour ${nom} illisibles (${lu.echec}) : ${PERTE}.`;
	if (lu.etat === 'absent') return `Hooks de Mnemo pour ${nom} non installés (${lu.chemin}) : ${PERTE}. Installe-les avec « mnemo init --${id} ».`;
	if (lu.etat === 'perime') return `Hooks de Mnemo pour ${nom} d'une autre installation de Mnemo (${lu.chemin}) : ${PERTE}. Refais-les avec « mnemo declarer --moteur ${id} --remplacer ».`;
	if (lu.approbation?.etat === 'a_approuver') return `Hooks de Mnemo pour ${nom} non approuvés : ${PERTE}. ${lu.approbation.motif}`;
	return null;
}

/** L'avertissement, en lignes du terminal de la session (avant ce que le moteur y écrit). */
export const lignesDAvertissement = (texte: string): string => `\r\n[Mnemo] ${texte.replace(/\r?\n/gu, '\r\n')}\r\n\r\n`;
