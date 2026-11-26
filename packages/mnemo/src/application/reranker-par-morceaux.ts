/**
 * Un reranker qui note par morceaux (préparation des messages de la page Entraîner, dans le service) : chaque appel est découpé
 * en morceaux de `taille` textes au plus, soumis l'un après l'autre. Le serveur du reranker est partagé avec les hooks : un hook
 * qui arrive pendant une préparation n'attend qu'un morceau, jamais toutes les candidates d'un message (comme pour l'affinage,
 * `MORCEAU_AFFINAGE`). La note d'un texte ne dépend que de la requête et de lui : le découpage ne la change pas. Un morceau sans
 * réponse rend null (les suivants ne sont pas soumis).
 */
import type { Reranker } from './ports.ts';

export function rerankerParMorceaux(reranker: Reranker, taille: number): Reranker {
	const pas = Math.max(1, Math.floor(taille));
	return {
		async noter(requete, textes, options) {
			if (textes.length <= pas) return reranker.noter(requete, textes, options);
			const notes: number[] = [];
			for (let debut = 0; debut < textes.length; debut += pas) {
				const morceau = textes.slice(debut, debut + pas);
				const r = await reranker.noter(requete, morceau, options);
				if (r === null || r.length !== morceau.length) return null;
				notes.push(...r);
			}
			return notes;
		},
	};
}
