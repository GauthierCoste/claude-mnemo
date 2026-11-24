/**
 * Couleurs du graphe 3D, lues dans les jetons de `jetons.css` à l'exécution (`getComputedStyle`) : three.js ne lit pas les
 * variables CSS, et aucune couleur ne s'écrit dans le code.
 */

export type CouleursGraphe = {
	/** Teintes des branches de premier niveau (et des notions), dans leur ordre, reprises en boucle. */
	branches: string[];
	/** Couleur de chaque état mémoire (`a_confirmer`, `a_reprendre`, `illisible`). */
	etats: Record<string, string>;
	lien: string;
	parente: string;
	eclaire: string;
	survol: string;
	/** Teinte mêlée aux halos (la lueur holographique). */
	lueur: string;
	lumiere: string;
	axe: string;
	/** Couleur d'un nœud sans catégorie de légende connue. */
	texteSecondaire: string;
	/** Fond de la scène : un nœud estompé se fond vers lui. */
	fond: string;
	/** Cible d'un lien cassé. */
	discret: string;
};

export const JETONS_GRAPHE = {
	lien: '--graphe-lien',
	parente: '--graphe-parente',
	eclaire: '--graphe-eclaire',
	survol: '--graphe-survol',
	lueur: '--graphe-lueur',
	lumiere: '--graphe-lumiere',
	axe: '--graphe-axe',
	texteSecondaire: '--graphe-texte-secondaire',
	fond: '--graphe-fond',
	discret: '--graphe-discret',
} as const;

export const JETONS_BRANCHES = Array.from({ length: 10 }, (_, rang) => `--branche-${rang + 1}`);

export const JETONS_ETATS = {
	a_confirmer: '--graphe-etat-a-confirmer',
	a_reprendre: '--graphe-etat-a-reprendre',
	illisible: '--graphe-etat-illisible',
} as const;

/** `#rgb` ou `#rrggbb` → `#rrggbb` en minuscules ; null sinon (les calculs de nuance et three.js veulent de l'hexadécimal). */
function versHexadecimal(valeur: string): string | null {
	const v = valeur.trim().toLowerCase();
	if (/^#[0-9a-f]{6}$/.test(v)) return v;
	if (/^#[0-9a-f]{3}$/.test(v)) return `#${[...v.slice(1)].map((c) => c + c).join('')}`;
	return null;
}

/** Jeton absent ou illisible → erreur qui le nomme. */
export function lireCouleursGraphe(style: Pick<CSSStyleDeclaration, 'getPropertyValue'>): CouleursGraphe {
	const lire = (jeton: string): string => {
		const brut = style.getPropertyValue(jeton).trim();
		if (!brut) throw new Error(`Jeton de couleur absent : ${jeton} (jetons.css).`);
		const couleur = versHexadecimal(brut);
		if (!couleur) throw new Error(`Jeton de couleur illisible : ${jeton} vaut « ${brut} », couleur hexadécimale attendue.`);
		return couleur;
	};
	const graphe = Object.fromEntries(Object.entries(JETONS_GRAPHE).map(([cle, jeton]) => [cle, lire(jeton)])) as Record<keyof typeof JETONS_GRAPHE, string>;
	return {
		...graphe,
		branches: JETONS_BRANCHES.map(lire),
		etats: Object.fromEntries(Object.entries(JETONS_ETATS).map(([etat, jeton]) => [etat, lire(jeton)])),
	};
}
