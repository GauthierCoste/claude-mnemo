import type { ReactNode } from 'react';
import s from './EcranJeton.module.css';

/**
 * Affiché quand ce navigateur n'a pas de jeton (ni dans l'adresse, ni gardé pour cette origine) ou que le service le refuse :
 * jamais de nouvelle tentative, jamais le jeton à l'écran.
 */
export function EcranJeton(): ReactNode {
	return (
		<div className={s.ecran}>
			<div className={s.carte} role="alert">
				<div className={s.marque}>
					mnemo<b>_</b>
				</div>
				<p>
					Jeton absent ou périmé. Ouvrir une fois l'adresse avec jeton affichée par <code>mnemo</code> (ou par <code>mnemo jeton</code>) dans le
					terminal : ce navigateur sera reconnu, l'adresse sans jeton suffira ensuite.
				</p>
			</div>
		</div>
	);
}
