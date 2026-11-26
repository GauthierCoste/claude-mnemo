/**
 * Pouvoirs d'un agent : les six hooks de Mnemo (Éveil, Souffle, Bouclier, Carnet, Veille, Récit), chacun un interrupteur
 * avec son effet. Au moins un reste allumé : le dernier ne s'éteint pas, et le dit.
 */
import type { EvenementHookVue } from '@mnemo/contrat';
import { useId, type ReactNode } from 'react';
import { HOOKS_PROFIL } from '../../../profils/hooks.ts';
import { basculer } from '../../../reglages/equipement.ts';
import s from './Agents.module.css';
import { Bloc } from './Bloc.tsx';

const ORDRE = HOOKS_PROFIL.map((h) => h.cle);

export function BlocPouvoirs(p: { hooks: EvenementHookVue[]; surChange(hooks: EvenementHookVue[]): void }): ReactNode {
	const id = useId();
	const dernier = p.hooks.length === 1 ? p.hooks[0] : undefined;
	return (
		<Bloc titre="Pouvoirs" sous="les hooks : les moments où Mnemo agit dans la session">
			<ul className={s.pouvoirs}>
				{HOOKS_PROFIL.map((h) => {
					const actif = p.hooks.includes(h.cle);
					const bloque = h.cle === dernier;
					return (
						<li key={h.cle}>
							<button
								type="button"
								role="switch"
								className={s.pouvoir}
								aria-checked={actif}
								aria-label={h.pouvoir}
								aria-describedby={bloque ? `${id}-effet-${h.cle} ${id}-dernier` : `${id}-effet-${h.cle}`}
								aria-disabled={bloque || undefined}
								onClick={() => !bloque && p.surChange(basculer(p.hooks, h.cle, !actif, ORDRE))}
							>
								<span className={s.rune} aria-hidden="true">
									{h.rune}
								</span>
								<span className={s.identite}>
									<b>{h.pouvoir}</b>
									<small id={`${id}-effet-${h.cle}`}>{h.effet}</small>
								</span>
							</button>
						</li>
					);
				})}
			</ul>
			{dernier !== undefined && (
				<p id={`${id}-dernier`} className={s.effet}>
					Au moins un pouvoir reste allumé.
				</p>
			)}
		</Bloc>
	);
}
