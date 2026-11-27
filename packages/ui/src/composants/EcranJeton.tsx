import type { ReactNode } from 'react';
import { useTextes } from '../langue/langue.tsx';
import s from './EcranJeton.module.css';

/**
 * Affiché quand ce navigateur n'a pas de jeton (ni dans l'adresse, ni gardé pour cette origine) ou que le service le refuse :
 * jamais de nouvelle tentative, jamais le jeton à l'écran.
 */
export function EcranJeton(): ReactNode {
	const t = useTextes();
	return (
		<div className={s.ecran}>
			<div className={s.carte} role="alert">
				<div className={s.marque}>
					mnemo<b>_</b>
				</div>
				<p>{t.coquille.ecranJeton(<code>mnemo</code>, <code>mnemo jeton</code>)}</p>
			</div>
		</div>
	);
}
