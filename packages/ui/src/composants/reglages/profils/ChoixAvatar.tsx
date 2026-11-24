/** Choix de l'avatar d'un profil : la forme (12 petites créatures) et la couleur, choisies séparément. */
import { COULEURS_AVATAR, FORMES_AVATAR } from '@mnemo/commun';
import type { Avatar, CouleurAvatar, FormeAvatar } from '@mnemo/commun';
import type { ReactNode } from 'react';
import { AvatarProfil, JETONS_COULEUR } from '../../commun/AvatarProfil.tsx';
import s from './Profils.module.css';

const NOMS_FORMES: Record<FormeAvatar, string> = {
	robot: 'Robot',
	chouette: 'Chouette',
	renard: 'Renard',
	fantome: 'Fantôme',
	chat: 'Chat',
	goutte: 'Goutte',
	lapin: 'Lapin',
	grenouille: 'Grenouille',
	pingouin: 'Pingouin',
	escargot: 'Escargot',
	champignon: 'Champignon',
	nuage: 'Nuage',
};

const NOMS_COULEURS: Record<CouleurAvatar, string> = { vert: 'Vert', violet: 'Violet', bleu: 'Bleu', ambre: 'Ambre', rouge: 'Rouge' };

export function ChoixAvatar(p: { avatar: Avatar; surChoix(a: Avatar): void }): ReactNode {
	return (
		<div className={s.choixAvatar}>
			<div role="radiogroup" aria-label="Forme de l’avatar" className={s.formes}>
				{FORMES_AVATAR.map((forme) => (
					<button
						key={forme}
						type="button"
						role="radio"
						aria-checked={p.avatar.forme === forme}
						title={NOMS_FORMES[forme]}
						className={s.forme}
						onClick={() => p.surChoix({ ...p.avatar, forme })}
					>
						<AvatarProfil avatar={{ forme, couleur: p.avatar.couleur }} taille={32} titre={NOMS_FORMES[forme]} />
					</button>
				))}
			</div>
			<div role="radiogroup" aria-label="Couleur de l’avatar" className={s.couleurs}>
				{COULEURS_AVATAR.map((couleur) => (
					<button
						key={couleur}
						type="button"
						role="radio"
						aria-checked={p.avatar.couleur === couleur}
						aria-label={NOMS_COULEURS[couleur]}
						title={NOMS_COULEURS[couleur]}
						className={s.couleur}
						style={{ background: JETONS_COULEUR[couleur] }}
						onClick={() => p.surChoix({ ...p.avatar, couleur })}
					/>
				))}
			</div>
		</div>
	);
}
