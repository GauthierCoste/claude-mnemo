import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';
import s from './Bouton.module.css';
import { cx } from './classes.ts';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
	/** `normal` : bouton courant ; `primaire` : l'action principale ; `icone` : bouton d'icône. */
	genre?: 'normal' | 'primaire' | 'icone';
	/** `.btn.s` : petit bouton. */
	petit?: boolean;
	/**
	 * Indisponible pour une raison dite à l'écran : `aria-disabled` plutôt que `disabled`, pour que le bouton garde le focus et
	 * annonce sa raison au clavier (l'id de l'élément qui la dit, en `aria-describedby`) ; le clic ne fait rien.
	 */
	indisponible?: { raison: string } | false;
	children?: ReactNode;
};

export function Bouton({ genre = 'normal', petit = false, indisponible = false, className, type = 'button', onClick, ...reste }: Props): ReactNode {
	const bloque = indisponible !== false;
	const clic = (e: MouseEvent<HTMLButtonElement>) => {
		if (bloque) {
			e.preventDefault();
			return;
		}
		onClick?.(e);
	};
	return (
		<button
			type={type}
			className={cx(genre === 'icone' ? s.icone : s.bouton, genre === 'primaire' && s.primaire, petit && s.petit, className)}
			{...reste}
			{...(bloque ? { 'aria-disabled': true, 'aria-describedby': indisponible.raison } : {})}
			onClick={clic}
		/>
	);
}
