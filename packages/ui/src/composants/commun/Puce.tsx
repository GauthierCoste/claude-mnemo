import type { CSSProperties, ReactNode } from 'react';
import { cx } from './classes.ts';
import s from './Puce.module.css';

/** Couleurs permises, chacune un jeton de `jetons.css` écrit en clair (le test des jetons les voit toutes). */
const COULEURS = {
	attend: 'var(--etat-attend)',
	travaille: 'var(--etat-travaille)',
	a_relire: 'var(--etat-a-relire)',
	en_pause: 'var(--etat-en-pause)',
	terminee: 'var(--etat-terminee)',
	accent: 'var(--ac)',
	violet: 'var(--violet)',
	bleu: 'var(--blue)',
	ambre: 'var(--amber)',
	rose: 'var(--pink)',
	rouge: 'var(--red)',
} as const;

export type CouleurPuce = keyof typeof COULEURS;

type Props = {
	children: ReactNode;
	/** Couleur de la puce : `avertissement` ou `succes`. */
	ton?: 'neutre' | 'avertissement' | 'succes';
	/** Texte et bordure de cette couleur, comme la puce d'état du panneau Contexte (états : même nom que `EtatSessionVue`). */
	couleur?: CouleurPuce;
	className?: string;
	title?: string;
};

export function Puce({ children, ton = 'neutre', couleur, className, title }: Props): ReactNode {
	const style = couleur ? ({ '--c': COULEURS[couleur] } as CSSProperties) : undefined;
	return (
		<span className={cx(s.puce, ton === 'avertissement' && s.avertissement, ton === 'succes' && s.succes, couleur && s.coloree, className)} style={style} title={title}>
			{children}
		</span>
	);
}
