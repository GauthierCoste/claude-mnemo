/**
 * Séparateur redimensionnable (motif « window splitter » de l'ARIA) : un trait fin à l'œil, large à la souris, focusable.
 * Glisser change la taille du panneau qu'il règle ; au clavier, les flèches de son axe (Maj : grand pas), Début/Fin
 * pour les bornes ; double-clic pour la taille par défaut. `sens` : +1 si la taille grandit quand le pointeur va vers la
 * droite (vertical) ou le bas (horizontal), -1 sinon. Pendant un glissement, `body` porte la classe `drag` : les
 * terminaux attendent la fin pour se réajuster.
 */
import { useRef, type ReactNode } from 'react';
import { cx } from './classes.ts';
import { useGestesSeparateur } from './gestes-separateur.ts';
import s from './Separateur.module.css';

export function Separateur(p: {
	/** `vertical` : trait vertical, règle une largeur ; `horizontal` : trait horizontal, règle une hauteur. */
	orientation: 'vertical' | 'horizontal';
	label: string;
	valeur: number;
	min: number;
	max: number;
	sens: 1 | -1;
	/** `fin` : geste terminé (touche, lâcher) ; faux pendant un glissement. */
	surChanger(px: number, fin: boolean): void;
	surDefaut(): void;
	/** Posé sur la bordure d'un panneau latéral : 8 px à la souris, sans prendre de place. */
	bord?: boolean;
	className?: string;
}): ReactNode {
	const vertical = p.orientation === 'vertical';
	const borne = (px: number) => Math.round(Math.min(p.max, Math.max(p.min, px)));
	const depart = useRef(p.valeur);
	const { glisse, gestes } = useGestesSeparateur({
		vertical,
		surDebut: () => {
			depart.current = p.valeur;
			return true;
		},
		surGlisser: (ecart) => p.surChanger(borne(depart.current + p.sens * ecart), false),
		surFin: () => p.surChanger(p.valeur, true),
		surClavier: (geste) => p.surChanger('pas' in geste ? borne(p.valeur + p.sens * geste.pas) : geste.borne === 'debut' ? p.min : p.max, true),
	});

	return (
		<div
			className={cx(s.separateur, vertical ? s.vertical : s.horizontal, p.bord && s.bord, p.className)}
			role="separator"
			aria-orientation={p.orientation}
			aria-label={p.label}
			aria-valuenow={p.valeur}
			aria-valuemin={p.min}
			aria-valuemax={p.max}
			tabIndex={0}
			title={`Glisser pour ${vertical ? 'élargir' : 'agrandir'} · double-clic : taille par défaut`}
			data-glisse={String(glisse)}
			{...gestes}
			onDoubleClick={p.surDefaut}
		/>
	);
}
