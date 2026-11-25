/**
 * Niveau des modèles locaux : `complets` (sens et reranker, par défaut), `sens` (sens seul), `coupes` (aucun modèle, les
 * mots seuls). Il vaut pour toute la machine, et une session peut en avoir un plus restrictif.
 */
export const NIVEAUX_MODELES = ['complets', 'sens', 'coupes'] as const;
export type NiveauModeles = (typeof NIVEAUX_MODELES)[number];

/** Niveau de la machine quand aucun n'est choisi. */
export const NIVEAU_MODELES_PAR_DEFAUT: NiveauModeles = 'complets';

export const estNiveauModeles = (v: unknown): v is NiveauModeles => typeof v === 'string' && (NIVEAUX_MODELES as readonly string[]).includes(v);

/** Rang d'un niveau : plus il est bas, moins le niveau permet de modèles. */
const RANG: Record<NiveauModeles, number> = { coupes: 0, sens: 1, complets: 2 };

/** Le plus restrictif du niveau global et de celui d'une session (null : la session suit le global). */
export function niveauEffectif(global: NiveauModeles, propre: NiveauModeles | null): NiveauModeles {
	return propre === null || RANG[global] <= RANG[propre] ? global : propre;
}

/** Vrai si `a` permet plus que `b` (« complets » est plus large que « sens seul », lui-même plus large que « coupés »). */
export function plusLarge(a: NiveauModeles, b: NiveauModeles): boolean {
	return RANG[a] > RANG[b];
}

/** Les modèles qu'un niveau permet d'appeler et de démarrer. */
export function modelesPermis(niveau: NiveauModeles): { sens: boolean; reranker: boolean } {
	return { sens: niveau !== 'coupes', reranker: niveau === 'complets' };
}

/** Vrai si passer de `ancien` à `nouveau` retire au moins un modèle (ce qui arrête les serveurs en marche). */
export function niveauRetireUnModele(ancien: NiveauModeles, nouveau: NiveauModeles): boolean {
	const avant = modelesPermis(ancien);
	const apres = modelesPermis(nouveau);
	return (avant.sens && !apres.sens) || (avant.reranker && !apres.reranker);
}
