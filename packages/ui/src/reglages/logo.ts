/**
 * Dessin du logo de Mnemo : un « m » en deux arches et ses échos (n puis m, décalés et pâlis : « m n m »), un trait de la
 * couleur principale sur un carré arrondi. Une seule description géométrique, sans DOM ni Node : elle donne le logo de la
 * barre de titre (`LogoMnemo`), l'icône de la page redessinée à la couleur choisie (`icone-page.ts`) et les fichiers
 * versionnés (`outils/icone.ts` : `public/icone.svg`, PNG de l'application installable et du lanceur macOS).
 */

/** Repère 512 × 512. */
export const COTE = 512;
export const FOND = { marge: 40, rayon: 96 } as const;
/** Le dessin est conçu pour une tuile pleine de 512 ; réduit autour du centre pour tenir dans le fond à marge. */
export const REDUCTION = (COTE - 2 * FOND.marge) / COTE;
export const TRAIT = 40;

/** Une arche : jambage gauche éventuel, demi-cercle de rayon 53 posé à y = 232, jambage droit jusqu'à y = 380. */
export const HAUT = 232;
export const BAS = 380;
export const RAYON = 53;
/** Abscisses gauches des arches d'une lettre. */
export type Lettre = readonly number[];
const M: Lettre = [150, 256];
const N: Lettre = [256];

/** Trois couches dans l'ordre m, n, m : le m devant, opaque ; le n puis le m en échos décalés de 20 vers le haut à droite. */
const PAS = 20;
/** Recentrage vertical : l'ensemble (échos compris) occupe 115 à 396, centré sur 256. */
const RECENTRAGE = -24;
export const COUCHES: readonly { lettre: Lettre; dx: number; dy: number; opacite: number }[] = [
	{ lettre: M, dx: PAS, dy: -PAS + RECENTRAGE, opacite: 0.18 },
	{ lettre: N, dx: 0, dy: RECENTRAGE, opacite: 0.4 },
	{ lettre: M, dx: -PAS, dy: PAS + RECENTRAGE, opacite: 1 },
];

/** Chemin SVG d'une lettre (repère de la tuile pleine, avant décalage). */
export function cheminLettre(lettre: Lettre): string {
	return lettre
		.map((x, i) => `${i === 0 ? `M${x} ${BAS} V${HAUT}` : `M${x} ${HAUT}`} A${RAYON} ${RAYON} 0 0 1 ${x + 2 * RAYON} ${HAUT} V${BAS}`)
		.join(' ');
}

/** Transformation du groupe des couches : la réduction autour du centre. */
export const TRANSFORMATION_COUCHES = `translate(${COTE / 2} ${COTE / 2}) scale(${REDUCTION}) translate(${-COTE / 2} ${-COTE / 2})`;

/** `standard` : carré arrondi avec une marge (fenêtre, Dock) ; `masquable` : fond plein, le dessin dans la zone sûre (80 %). */
export type Variante = 'standard' | 'masquable';

/** Le SVG du logo, aux couleurs données (`fond`, `trait` : toute couleur CSS). */
export function svgLogo(variante: Variante, couleurs: { fond: string; trait: string }): string {
	const fond =
		variante === 'standard'
			? `<rect x="${FOND.marge}" y="${FOND.marge}" width="${COTE - 2 * FOND.marge}" height="${COTE - 2 * FOND.marge}" rx="${FOND.rayon}" fill="${couleurs.fond}"/>`
			: `<rect width="${COTE}" height="${COTE}" fill="${couleurs.fond}"/>`;
	const couches = COUCHES.map(
		(k) => `<path d="${cheminLettre(k.lettre)}" transform="translate(${k.dx} ${k.dy})"${k.opacite < 1 ? ` opacity="${k.opacite}"` : ''}/>`,
	).join('\n    ');
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${COTE} ${COTE}">
  <title>Mnemo</title>
  ${fond}
  <g transform="${TRANSFORMATION_COUCHES}" fill="none" stroke="${couleurs.trait}" stroke-width="${TRAIT}" stroke-linecap="round" stroke-linejoin="round">
    ${couches}
  </g>
</svg>
`;
}
