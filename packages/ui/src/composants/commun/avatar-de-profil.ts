/** Avatar d'un profil par son nom, lu dans la liste des profils du service ; celui par défaut si le profil est inconnu. */
import type { Avatar } from '@mnemo/commun';
import { useMemo } from 'react';
import { useProfils } from '../../client/hooks.ts';
import { AVATAR_PAR_DEFAUT } from './AvatarProfil.tsx';

export function useAvatarsDeProfils(): (profil: string) => Avatar {
	const profils = useProfils().donnees?.profils;
	return useMemo(() => {
		const avatars = new Map((profils ?? []).map((x) => [x.nom, x.avatar]));
		return (profil: string) => avatars.get(profil) ?? AVATAR_PAR_DEFAUT;
	}, [profils]);
}
