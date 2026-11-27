/**
 * Éléments communs aux arbres (Mémoire › Fichiers, arbre des dossiers) : le chevron qui tourne d'un quart une fois ouvert,
 * l'icône de dossier ouvert ou fermé, et les traits de guide. Une ligne de l'arbre commence son surlignage au libellé
 * (icône puis nom), à `margeArbre(profondeur)` ; le chevron reste dehors, à gauche, et les traits des dossiers parents
 * passent hors du fond, dans la marge.
 */
import type { CSSProperties, ReactNode } from 'react';
import { cx } from './classes.ts';
import s from './ElementsArbre.module.css';

/** Retrait d'un niveau de l'arbre. */
export const RETRAIT_ARBRE = 16;
/** Place du chevron, avant le libellé. */
const PLACE_CHEVRON = 22;
/** Position du trait d'un dossier : sous le milieu de son chevron. */
const TRAIT = 11;

/** Où commence le libellé (et son surlignage) d'une ligne de profondeur `profondeur`. */
export const margeArbre = (profondeur: number): number => profondeur * RETRAIT_ARBRE + PLACE_CHEVRON;

const trait = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** Chevron d'un dossier, posé dans la marge à gauche du libellé ; pointe vers le bas quand le dossier est ouvert. */
export function ChevronArbre(p: { ouvert: boolean }): ReactNode {
	return (
		<svg className={cx(s.chevron, p.ouvert && s.ouvert)} viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
			<path d="M6 3.5 10.5 8 6 12.5" {...trait} />
		</svg>
	);
}

/** Icône de dossier, ouvert ou fermé. */
export function IconeDossier(p: { ouvert: boolean }): ReactNode {
	return (
		<svg className={cx(s.icone, p.ouvert && s.ouvert)} viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
			{p.ouvert ? (
				<>
					<path d="M1.75 11.9V4.25c0-.69.56-1.25 1.25-1.25h3.1l1.5 1.6H12c.69 0 1.25.56 1.25 1.25V6.9" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
					<path
						d="M1.9 12.6 3.6 7.6c.15-.42.55-.7 1-.7h9.4c.68 0 1.17.67.96 1.32l-1.4 4.2c-.15.43-.55.73-1.01.73H2.6a.73.73 0 0 1-.7-.55z"
						fill="currentColor"
						fillOpacity=".14"
						stroke="currentColor"
						strokeWidth="1.3"
						strokeLinejoin="round"
					/>
				</>
			) : (
				<path d="M1.75 4.25c0-.69.56-1.25 1.25-1.25h3.1l1.5 1.6H13c.69 0 1.25.56 1.25 1.25v6.4c0 .69-.56 1.25-1.25 1.25H3c-.69 0-1.25-.56-1.25-1.25z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
			)}
		</svg>
	);
}

/**
 * Traits de guide d'une ligne : un par dossier qui la contient, du premier niveau au plus proche (`niveaux`, vrai pour un
 * dossier sur le chemin de l'élément choisi, tracé en couleur). Posés en absolu dans la ligne, dont le bord gauche est à
 * `debut` px du bord de l'arbre ; mis bout à bout d'une ligne à l'autre, ils descendent d'un dossier ouvert jusqu'à son
 * dernier contenu.
 */
export function GuidesArbre(p: { niveaux: readonly boolean[]; debut: number }): ReactNode {
	return p.niveaux.map((courant, k) => <span key={k} className={cx(s.guide, courant && s.courant)} style={{ left: k * RETRAIT_ARBRE + TRAIT - p.debut } as CSSProperties} aria-hidden="true" />);
}
