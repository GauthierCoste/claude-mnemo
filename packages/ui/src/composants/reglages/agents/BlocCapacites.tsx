/**
 * Capacités d'un agent : les six hooks de Mnemo, chacun avec son effet. Éveil, Veille et Récit tiennent l'état de la session :
 * toujours actifs (le service les garde quel que soit l'agent), allumés et non basculables, avec la raison. Souffle,
 * Bouclier et Carnet se basculent. La liste enregistrée garde toujours les trois premiers : jamais vide (le service en
 * demande au moins un).
 */
import type { EvenementHookVue } from '@mnemo/contrat';
import { useId, type ReactNode } from 'react';
import { HOOKS_PROFIL, HOOKS_TOUJOURS } from '../../../profils/hooks.ts';
import { basculer } from '../../../reglages/equipement.ts';
import s from './Agents.module.css';
import { Bloc } from './Bloc.tsx';

const ORDRE = HOOKS_PROFIL.map((h) => h.cle);

/** `hooks` après la bascule de `cle`, les hooks toujours actifs compris. */
const basculerCapacite = (hooks: EvenementHookVue[], cle: EvenementHookVue, actif: boolean): EvenementHookVue[] =>
	HOOKS_TOUJOURS.reduce((h, t) => basculer(h, t, true, ORDRE), basculer(hooks, cle, actif, ORDRE));

export function BlocCapacites(p: { hooks: EvenementHookVue[]; surChange(hooks: EvenementHookVue[]): void }): ReactNode {
	const id = useId();
	return (
		<Bloc titre="Capacités" sous="les hooks : les moments où Mnemo agit dans la session">
			<ul className={s.capacites}>
				{HOOKS_PROFIL.map((h) => {
					const actif = h.toujours || p.hooks.includes(h.cle);
					return (
						<li key={h.cle}>
							<button
								type="button"
								role="switch"
								className={s.capacite}
								aria-checked={actif}
								aria-label={h.capacite}
								aria-describedby={h.toujours ? `${id}-effet-${h.cle} ${id}-toujours` : `${id}-effet-${h.cle}`}
								aria-disabled={h.toujours || undefined}
								onClick={() => !h.toujours && p.surChange(basculerCapacite(p.hooks, h.cle, !actif))}
							>
								<span className={s.symbole} aria-hidden="true">
									{h.symbole}
								</span>
								<span className={s.identite}>
									<b>{h.capacite}</b>
									<small id={`${id}-effet-${h.cle}`}>{h.effet}</small>
								</span>
							</button>
						</li>
					);
				})}
			</ul>
			<p id={`${id}-toujours`} className={s.effet}>
				Éveil, Veille et Récit : toujours actifs, ils tiennent l’état de la session.
			</p>
		</Bloc>
	);
}
