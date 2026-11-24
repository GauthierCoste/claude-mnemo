import type { ButtonHTMLAttributes, ReactNode } from 'react';
import s from './Bouton.module.css';
import { cx } from './classes.ts';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
	/** `normal` : bouton courant ; `primaire` : l'action principale ; `icone` : bouton d'icône. */
	genre?: 'normal' | 'primaire' | 'icone';
	/** `.btn.s` : petit bouton. */
	petit?: boolean;
	children?: ReactNode;
};

export function Bouton({ genre = 'normal', petit = false, className, type = 'button', ...reste }: Props): ReactNode {
	return <button type={type} className={cx(genre === 'icone' ? s.icone : s.bouton, genre === 'primaire' && s.primaire, petit && s.petit, className)} {...reste} />;
}
