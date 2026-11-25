import { modelesPermis } from '@mnemo/commun';
import type { NiveauModeles } from '@mnemo/commun';
import type { Dependances, EtatSessions, Reranker, Sens } from './ports.ts';

/**
 * Le sens et le reranker vus d'une session : un modèle que le niveau propre de la session exclut n'est ni appelé ni démarré
 * (null tout de suite, l'étape saute : la recherche se fait par les mots). Le niveau est relu à chaque appel, car
 * l'utilisateur peut le changer en cours de session ; null (lecture échouée, session inconnue, aucun niveau propre) : rien
 * n'est retiré ici. Choix : une lecture échouée suit le niveau de la machine (une panne de l'état ne coupe pas les modèles). Le niveau de la machine est appliqué par les modèles enveloppés eux-mêmes : la session a donc le plus
 * restrictif des deux (`niveauEffectif`). `modele()` (identité du modèle installé, pour le cache des vecteurs) reste tel quel.
 */
export function modelesDeSession(modeles: { sens: Sens; reranker: Reranker }, niveauPropre: () => Promise<NiveauModeles | null>): { sens: Sens; reranker: Reranker } {
	// pris maintenant : l'appelant peut remplacer ensuite ses propres modèles par l'enveloppe (sans boucler sur elle)
	const { sens, reranker } = modeles;
	const permis = async () => modelesPermis((await niveauPropre().catch(() => null)) ?? 'complets');
	return {
		sens: {
			modele: () => sens.modele(),
			async vecteurs(textes, options) {
				if (textes.length > 0 && !(await permis()).sens) return null;
				return sens.vecteurs(textes, options);
			},
		},
		reranker: {
			async noter(requete, textes, options) {
				if (textes.length > 0 && !(await permis()).reranker) return null;
				return reranker.noter(requete, textes, options);
			},
		},
	};
}

/** Niveau propre de la session `id`, lu dans l'état des sessions ; null s'il n'y en a pas ou si la lecture échoue. */
export function niveauPropreDe(etat: Pick<EtatSessions, 'lire'>, id: string): () => Promise<NiveauModeles | null> {
	return async () => (await etat.lire(id).catch(() => null))?.niveauModeles ?? null;
}

/** Les dépendances d'une session : les mêmes, sens et reranker bornés par le niveau de la session `id` (`modelesDeSession`). */
export function dependancesDeSession(dep: Dependances, etat: Pick<EtatSessions, 'lire'>, id: string): Dependances {
	return { ...dep, ...modelesDeSession(dep, niveauPropreDe(etat, id)) };
}
