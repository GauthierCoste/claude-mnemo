/** Apparence d'un agent : la forme de son avatar (12 petites créatures) et sa couleur, choisies séparément. */
import { COULEURS_AVATAR, FORMES_AVATAR } from '@mnemo/commun';
import type { Avatar } from '@mnemo/commun';
import type { ReactNode } from 'react';
import { useTextes } from '../../../langue/langue.tsx';
import { AvatarProfil, JETONS_COULEUR } from '../../commun/AvatarProfil.tsx';
import s from './Agents.module.css';
import { Bloc } from './Bloc.tsx';

export function BlocApparence(p: { avatar: Avatar; surChoix(a: Avatar): void }): ReactNode {
	const t = useTextes().agents.apparence;
	return (
		<Bloc titre={t.titre} sous={t.sous}>
			<div role="radiogroup" aria-label={t.forme} className={s.formes}>
				{FORMES_AVATAR.map((forme) => (
					<button key={forme} type="button" role="radio" aria-checked={p.avatar.forme === forme} title={t.formes[forme]} className={s.forme} onClick={() => p.surChoix({ ...p.avatar, forme })}>
						<AvatarProfil avatar={{ forme, couleur: p.avatar.couleur }} taille="pleine" sansFond titre={t.formes[forme]} />
					</button>
				))}
			</div>
			<div role="radiogroup" aria-label={t.couleur} className={s.couleurs}>
				{COULEURS_AVATAR.map((couleur) => (
					<button
						key={couleur}
						type="button"
						role="radio"
						aria-checked={p.avatar.couleur === couleur}
						aria-label={t.couleurs[couleur]}
						title={t.couleurs[couleur]}
						className={s.couleur}
						style={{ background: JETONS_COULEUR[couleur] }}
						onClick={() => p.surChoix({ ...p.avatar, couleur })}
					/>
				))}
			</div>
		</Bloc>
	);
}
