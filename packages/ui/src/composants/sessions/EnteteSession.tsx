/**
 * En-tête du panneau Contexte : l'avatar de la session (grand), le nom du profil dans sa couleur et l'état, puis l'objectif.
 * Un `div`, pas un `header` : hors d'une section, il serait une seconde bannière de la page (celle de la barre de titre).
 */
import type { SessionVue } from '@mnemo/contrat';
import type { CSSProperties, ReactNode } from 'react';
import { libelleEtat } from '../../sessions/etats.ts';
import { JETONS_COULEUR } from '../commun/AvatarProfil.tsx';
import { useAvatarsDeProfils } from '../commun/avatar-de-profil.ts';
import { Puce } from '../commun/Puce.tsx';
import { AvatarSession } from './AvatarSession.tsx';
import s from './EnteteSession.module.css';

export function EnteteSession(p: { session: SessionVue }): ReactNode {
	const avatarDe = useAvatarsDeProfils();
	const x = p.session;
	const style = { '--profil': JETONS_COULEUR[avatarDe(x.profil).couleur] } as CSSProperties;
	return (
		<div className={s.entete} style={style}>
			<AvatarSession session={x} taille="grand" />
			<div className={s.texte}>
				<div className={s.ligne}>
					<span className={s.profil}>{x.profil}</span>
					<Puce couleur={x.etat}>{libelleEtat(x)}</Puce>
				</div>
				<h2 className={s.objectif}>{x.objectif ?? 'Sans objectif'}</h2>
			</div>
		</div>
	);
}
