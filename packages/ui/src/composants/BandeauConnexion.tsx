import type { ReactNode } from 'react';
import s from './BandeauConnexion.module.css';

/** Bandeau affiché tant que la connexion au service est coupée. */
export function BandeauConnexion(): ReactNode {
	return (
		<div className={s.bandeau} role="status">
			<span className={s.point} aria-hidden="true" />
			Service arrêté — reconnexion…
		</div>
	);
}
