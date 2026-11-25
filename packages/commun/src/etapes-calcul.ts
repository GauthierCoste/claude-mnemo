/**
 * Étapes du calcul qui suit un message porteur d'une session, diffusées pendant qu'elles durent (bouton des modèles de la
 * session) : au hook, `recherche` (candidates par les mots et le sens), `reranker` (les premières notées au hook), `note`
 * (la note de confiance), `lecture` (les fiches à injecter par Mnemo, lues entières) ; en fond, `sens` (le sens manquait au
 * hook) et `affinage` (le reranker sur les candidates, par paquets : `fait` sur `total`).
 */
export const ETAPES_CALCUL = ['recherche', 'reranker', 'note', 'lecture', 'sens', 'affinage'] as const;
export type NomEtapeCalcul = (typeof ETAPES_CALCUL)[number];

/** Une étape en cours ; `fait` et `total` : sa progression, quand elle se compte. */
export type EtapeCalcul = { nom: NomEtapeCalcul; fait?: number; total?: number };

export const estNomEtapeCalcul = (v: unknown): v is NomEtapeCalcul => typeof v === 'string' && (ETAPES_CALCUL as readonly string[]).includes(v);

const LIBELLES: Record<NomEtapeCalcul, string> = {
	recherche: 'recherche…',
	reranker: 'reranker…',
	note: 'note…',
	lecture: 'lecture des fiches…',
	sens: 'sens…',
	affinage: 'affinage…',
};

/** Libellé court d'une étape : « affinage 10/30… » quand elle se compte. */
export function libelleEtapeCalcul(e: EtapeCalcul): string {
	if (e.fait !== undefined && e.total !== undefined && e.total > 0) return `${e.nom} ${e.fait}/${e.total}…`;
	return LIBELLES[e.nom];
}
