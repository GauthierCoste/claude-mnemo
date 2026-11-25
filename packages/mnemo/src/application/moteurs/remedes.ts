import type { MoteurDuPoste } from '../ports.ts';
import { CATALOGUE_MOTEURS } from '../../domaine/moteurs/catalogue.ts';
import { MOTEUR_PAR_DEFAUT } from '../../domaine/moteurs/moteur.ts';

/**
 * Commandes `mnemo` qui remédient à l'état d'un moteur sur le poste, tirées de son installation : `declarer` (déclaration MCP
 * et hooks du poste absents), `remplacer` (faits pour un autre Node ou un autre Mnemo).
 */
export type RemedesDuMoteur = { declarer: string; remplacer: string };

export function remedesDuMoteur(moteur: Pick<MoteurDuPoste, 'id'>): RemedesDuMoteur {
	const option = moteur.id === MOTEUR_PAR_DEFAUT ? '' : ` --moteur ${moteur.id}`;
	return { declarer: `mnemo init ${CATALOGUE_MOTEURS[moteur.id].optionInit}`, remplacer: `mnemo declarer${option} --remplacer` };
}
