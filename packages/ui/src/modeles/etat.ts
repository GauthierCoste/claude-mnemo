/**
 * Lecture de l'état des modèles locaux, partagée par l'interface et la démonstration : les modèles utiles (permis par le niveau
 * de la machine et installés) sont-ils tous prêts, et faut-il proposer « Démarrer » plutôt qu'« Arrêter » ?
 */
import type { EtatModelesVue } from '@mnemo/contrat';

/** Vrai si chaque modèle permis et installé est prêt (et qu'il y en a au moins un). */
export function modelesUtilesPrets(e: Pick<EtatModelesVue, 'sens' | 'reranker'>): boolean {
	const utiles = [e.sens, e.reranker].filter((x) => x !== 'absent' && x !== 'exclu');
	return utiles.length > 0 && utiles.every((x) => x === 'pret');
}

/**
 * « Démarrer » plutôt qu'« Arrêter » : rien en marche, un échec, ou un gardien prêt à qui manque un modèle utile (un niveau
 * élargi depuis son lancement : « Démarrer » le remplace).
 */
export function aDemarrer(e: Pick<EtatModelesVue, 'gardien' | 'sens' | 'reranker'>): boolean {
	return e.gardien === 'arrete' || e.gardien === 'echec' || (e.gardien === 'pret' && !modelesUtilesPrets(e));
}
