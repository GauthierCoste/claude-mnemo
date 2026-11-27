/**
 * Couleur principale de l'interface (réglage `interface.accent`) : posée sur `--ac` de la page à l'exécution ; les fonds
 * atténués en dérivent par `color-mix` dans les CSS. Le texte posé sur l'accent (`--sur-accent`) est sombre ou clair selon
 * la luminance de l'accent : le rapport de contraste le plus grand l'emporte (formule WCAG), donc texte sombre sur un accent
 * clair, texte clair sur un accent foncé. Le logo suit : celui de la barre de titre par `var(--ac)`, l'icône de la page
 * (onglet du navigateur, Dock de l'app de bureau) redessinée à la couleur choisie (`icone-page.ts`).
 */

import { ACCENT_PAR_DEFAUT, estCouleurHex } from '@mnemo/commun';
import { poserIconePage } from './icone-page.ts';

export { ACCENT_PAR_DEFAUT };

/** Luminance relative du texte sombre (`--sur-accent-sombre` dans `jetons.css`). */
const LUMINANCE_TEXTE_SOMBRE = 0.0164;

/** Luminance relative WCAG (0 noir, 1 blanc) d'une couleur `#rrggbb`. */
export function luminance(hex: string): number {
	const [r, v, b] = [1, 3, 5].map((i) => {
		const c = parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	return 0.2126 * r + 0.7152 * v + 0.0722 * b;
}

/** Rapport de contraste WCAG (1 à 21) entre deux couleurs `#rrggbb`. */
export function contraste(a: string, b: string): number {
	const [clair, sombre] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
	return (clair + 0.05) / (sombre + 0.05);
}

/** Rapport minimal pour qu'un élément d'interface (filet, icône, texte large) se lise sur le fond. */
export const CONTRASTE_MINIMAL = 3;

/** Texte à poser sur cet accent : le plus contrasté, le sombre en cas d'égalité. */
export function texteSurAccent(hex: string): 'sombre' | 'clair' {
	const l = luminance(hex);
	const contrasteSombre = (l + 0.05) / (LUMINANCE_TEXTE_SOMBRE + 0.05);
	const contrasteClair = 1.05 / (l + 0.05);
	return contrasteSombre >= contrasteClair ? 'sombre' : 'clair';
}

/** Événement émis sur la racine à chaque changement d'accent : le graphe 3D et le terminal relisent alors leurs jetons. */
export const EVENEMENT_ACCENT = 'mnemo:accent';

/** Appelle `f` à chaque changement d'accent posé sur `racine` ; rend la fonction qui se désabonne. */
export function surChangementAccent(racine: HTMLElement, f: () => void): () => void {
	racine.addEventListener(EVENEMENT_ACCENT, f);
	return () => racine.removeEventListener(EVENEMENT_ACCENT, f);
}

/** Jeton du texte sur l'accent, écrit en entier : chaque `var(--…)` reste lisible (et vérifiable) dans `jetons.css`. */
const JETONS_SUR_ACCENT = { sombre: 'var(--sur-accent-sombre)', clair: 'var(--sur-accent-clair)' } as const;

/**
 * Saisie libre d'une couleur, normalisée en `#rrggbb` minuscule : `#` facultatif, forme courte `#rgb` dépliée, espaces
 * ignorés ; null si ce n'est pas une couleur hexadécimale.
 */
export function normaliserHex(texte: string): string | null {
	const brut = texte.trim().replace(/^#/, '').toLowerCase();
	const long = /^[0-9a-f]{3}$/.test(brut) ? [...brut].map((x) => x + x).join('') : brut;
	return /^[0-9a-f]{6}$/.test(long) ? `#${long}` : null;
}

/**
 * Pose l'accent (`--ac`) et le texte qui s'y lit (`--sur-accent`) sur `racine` ; une valeur invalide pose le défaut ; redessine
 * l'icône de la page à cette couleur ; prévient les abonnés (`surChangementAccent`).
 */
export function appliquerAccent(racine: HTMLElement, accent: unknown): void {
	const hex = estCouleurHex(accent) ? accent.toLowerCase() : ACCENT_PAR_DEFAUT;
	racine.style.setProperty('--ac', hex);
	racine.style.setProperty('--sur-accent', JETONS_SUR_ACCENT[texteSurAccent(hex)]);
	const fond = getComputedStyle(racine).getPropertyValue('--s1').trim().toLowerCase();
	if (estCouleurHex(fond)) poserIconePage({ fond, trait: hex });
	racine.dispatchEvent(new CustomEvent(EVENEMENT_ACCENT));
}
