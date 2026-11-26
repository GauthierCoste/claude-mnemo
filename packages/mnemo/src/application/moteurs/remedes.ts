import type { MoteurDuPoste } from '../ports.ts';
import { MOTEUR_PAR_DEFAUT } from '../../domaine/moteurs/moteur.ts';

/**
 * Commandes `mnemo` qui remédient à l'état d'un moteur sur le poste : `declarer` (déclaration MCP et hooks du poste absents),
 * `remplacer` (faits pour un autre Node ou un autre Mnemo). Les deux sont `mnemo declarer --lier`, qui lie le moteur sans
 * question, où qu'on la lance (comme le bouton « Lier à Mnemo ») : elle déclare ce qui manque et refait ce qui est périmé.
 */
export type RemedesDuMoteur = { declarer: string; remplacer: string };

export function remedesDuMoteur(moteur: Pick<MoteurDuPoste, 'id'>): RemedesDuMoteur {
	const option = moteur.id === MOTEUR_PAR_DEFAUT ? '' : ` --moteur ${moteur.id}`;
	const lier = `mnemo declarer${option} --lier`;
	return { declarer: lier, remplacer: lier };
}
