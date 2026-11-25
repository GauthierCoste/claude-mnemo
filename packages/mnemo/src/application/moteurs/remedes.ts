import type { MoteurDuPoste } from '../ports.ts';
import { CATALOGUE_MOTEURS } from '../../domaine/moteurs/catalogue.ts';
import { MOTEUR_PAR_DEFAUT } from '../../domaine/moteurs/moteur.ts';

/**
 * Commandes `mnemo` qui remédient à l'état d'un moteur sur le poste, tirées de son installation : `declarer` (déclaration MCP
 * et hooks du poste absents), `remplacer` (faits pour un autre Node ou un autre Mnemo), `retirer`.
 */
export type RemedesDuMoteur = { declarer: string; remplacer: string; retirer: string };

export function remedesDuMoteur(moteur: Pick<MoteurDuPoste, 'id' | 'installation'>): RemedesDuMoteur {
	const option = moteur.id === MOTEUR_PAR_DEFAUT ? '' : ` --moteur ${moteur.id}`;
	return { declarer: `mnemo init ${CATALOGUE_MOTEURS[moteur.id].optionInit}`, remplacer: `mnemo declarer${option} --remplacer`, retirer: `mnemo declarer${option} --retirer` };
}
