/**
 * Mission d'un agent : sa consigne. Tant qu'elle n'est pas écrite, c'est celle par défaut (elle suit les mises à jour de
 * Mnemo) ; la modifier la personnalise ; « Revenir à la consigne par défaut » la rend.
 */
import type { ReactNode } from 'react';
import { useTextes } from '../../../langue/langue.tsx';
import { Bouton } from '../../commun/Bouton.tsx';
import f from '../champs/Saisie.module.css';
import s from './Agents.module.css';
import { Bloc } from './Bloc.tsx';

export function BlocMission(p: { consigne: string | null; consigneParDefaut: string; surChange(consigne: string | null): void }): ReactNode {
	const t = useTextes().agents.mission;
	const parDefaut = p.consigne === null;
	return (
		<Bloc titre={t.titre} sous={t.sous}>
			<textarea
				className={`${f.texteLong} ${s.mission}`}
				aria-label={t.consigne}
				spellCheck
				rows={8}
				value={p.consigne ?? p.consigneParDefaut}
				onChange={(e) => p.surChange(e.target.value)}
			/>
			<div className={s.ligneMission}>
				{parDefaut ? (
					<p className={s.effet}>{t.parDefaut}</p>
				) : (
					<>
						<p className={s.effet}>{t.personnalisee}</p>
						<Bouton petit onClick={() => p.surChange(null)}>
							{t.revenir}
						</Bouton>
					</>
				)}
			</div>
		</Bloc>
	);
}
