/**
 * Verrou du fichier des jugements pour les commandes `mnemo banc contexte` (`infra/verrou-banc.ts`) : un refus (le fichier est
 * tenu par une autre commande ou par une tâche du service) devient une erreur attendue du CLI, qui nomme l'opération en cours.
 */
import { ErreurVerrouBanc, prendreVerrouBanc as prendre } from '../../infra/verrou-banc.ts';
import { ErreurCli } from './erreurs.ts';

/** Prend le verrou pour `operation` (« --juger », « --extraire »…) ; rend de quoi le rendre. */
export function prendreVerrouBanc(fichier: string, operation: string): () => void {
	try {
		return prendre(fichier, operation);
	} catch (e) {
		throw e instanceof ErreurVerrouBanc ? new ErreurCli(e.message) : e;
	}
}
