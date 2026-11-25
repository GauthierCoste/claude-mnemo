import { NOMS_MOTEURS } from '@mnemo/commun';
import type { LectureHooksDuPoste, MoteurDuPoste } from '../ports.ts';
import { remedesDuMoteur } from './remedes.ts';

/** Ce qu'une session perd quand les hooks de son moteur ne s'exécutent pas. */
const PERTE = 'cette session ne transmettra rien à Mnemo (état, contexte servi, consignes vérifiées, épisode)';

/**
 * Avertissement d'une session dont le moteur prend les hooks de Mnemo installés pour tout le poste (Codex, Mistral Vibe) : hooks absents,
 * d'une autre installation, illisibles, ou pas approuvés chez le moteur. La session se lance quand même ; null : rien à
 * signaler (approbation lue, ou impossible à vérifier : `verifier-poste` le dit).
 */
export function avertissementDesHooks(moteur: Pick<MoteurDuPoste, 'id'>, lu: LectureHooksDuPoste): string | null {
	const nom = NOMS_MOTEURS[moteur.id];
	const r = remedesDuMoteur(moteur);
	if ('echec' in lu) return `Hooks de Mnemo pour ${nom} illisibles (${lu.echec}) : ${PERTE}.`;
	if (lu.etat === 'absent') return `Hooks de Mnemo pour ${nom} non installés (${lu.chemin}) : ${PERTE}. Installe-les avec « ${r.declarer} ».`;
	if (lu.etat === 'perime') return `Hooks de Mnemo pour ${nom} d'une autre installation de Mnemo (${lu.chemin}) : ${PERTE}. Refais-les avec « ${r.remplacer} ».`;
	if (lu.approbation?.etat === 'a_approuver') return `Hooks de Mnemo pour ${nom} non approuvés : ${PERTE}. ${lu.approbation.motif}`;
	return null;
}

/** Réglages de la déclaration MCP de l'utilisateur qui changent ce qu'une session reçoit de Mnemo (variables, outils). */
const REGLAGES_QUI_COMPTENT = /^(?:env|enabled_tools|disabled_tools)(?:\.|$)/u;

/**
 * Avertissement d'une session dont le moteur garde, dans la déclaration MCP `mnemo` de l'utilisateur, des variables (`env`)
 * ou une liste d'outils permis ou retirés : ils s'appliquent aussi à la session ; null s'il n'y en a pas.
 */
export function avertissementDesReglagesMcp(nom: string, reglages: readonly string[]): string | null {
	const cles = [...new Set(reglages.filter((c) => REGLAGES_QUI_COMPTENT.test(c)).map((c) => c.split('.')[0]!))];
	if (cles.length === 0) return null;
	return `La déclaration du serveur MCP « mnemo » chez ${nom} porte ${cles.join(', ')} : ces réglages valent aussi pour cette session (variables, outils de Mnemo permis ou retirés).`;
}

/** L'avertissement, en lignes du terminal de la session (avant ce que le moteur y écrit). */
export const lignesDAvertissement = (texte: string): string => `\r\n[Mnemo] ${texte.replace(/\r?\n/gu, '\r\n')}\r\n\r\n`;
