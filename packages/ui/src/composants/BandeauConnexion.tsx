import type { ReactNode } from 'react';
import { useTextes } from '../langue/langue.tsx';
import s from './BandeauConnexion.module.css';

/** Bandeau affiché tant que la connexion au service est coupée. */
export function BandeauConnexion(): ReactNode {
	const t = useTextes();
	return (
		<div className={s.bandeau} role="status">
			<span className={s.point} aria-hidden="true" />
			{t.coquille.bandeauConnexion}
		</div>
	);
}
