/**
 * Avatar d'un profil de session : une petite créature (forme) sur une pastille, dans la couleur du profil (jeton du thème).
 */
import type { Avatar, CouleurAvatar } from '@mnemo/commun';
import type { ReactNode } from 'react';
import { useTextes } from '../../langue/langue.tsx';
import { DESSINS_AVATAR } from './avatars-dessins.tsx';

/** Jeton du thème de chaque couleur d'avatar. */
export const JETONS_COULEUR: Record<CouleurAvatar, string> = {
	vert: 'var(--vert)',
	violet: 'var(--violet)',
	bleu: 'var(--blue)',
	ambre: 'var(--amber)',
	rouge: 'var(--red)',
};

/** Avatar par défaut (celui du profil `travail`), pour un profil inconnu ou supprimé. */
export const AVATAR_PAR_DEFAUT: Avatar = { forme: 'robot', couleur: 'vert' };

/**
 * `sansFond` : sans la pastille ronde, pour un avatar posé sur un fond à lui (tuile de l'en-tête de session) ; `taille`
 * `pleine` : il remplit son conteneur (le personnage en grand de la Nouvelle session, sa vignette).
 */
export function AvatarProfil(p: { avatar: Avatar; taille?: 12 | 16 | 24 | 32 | 48 | 64 | 'pleine'; titre?: string; sansFond?: boolean }): ReactNode {
	const t = useTextes();
	const taille = p.taille === 'pleine' ? '100%' : (p.taille ?? 24);
	return (
		<svg
			role="img"
			aria-label={p.titre ?? t.coquille.partage.avatar(p.avatar.forme)}
			width={taille}
			height={taille}
			viewBox="0 0 48 48"
			style={{ color: JETONS_COULEUR[p.avatar.couleur], flexShrink: 0 }}
		>
			{!p.sansFond && <circle cx="24" cy="24" r="24" fill="var(--s2)" />}
			{DESSINS_AVATAR[p.avatar.forme]}
		</svg>
	);
}
