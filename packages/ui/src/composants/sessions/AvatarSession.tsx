/**
 * Avatar d'une session : la créature de son profil dans une tuile teintée à la couleur du profil, avec la pastille de
 * l'état en coin (elle pulse quand la session travaille). Trois tailles (`TailleAvatarSession`).
 */
import type { SessionVue } from '@mnemo/contrat';
import type { CSSProperties, ReactNode } from 'react';
import { libelleEtat } from '../../sessions/etats.ts';
import { AvatarProfil, JETONS_COULEUR } from '../commun/AvatarProfil.tsx';
import { useAvatarsDeProfils } from '../commun/avatar-de-profil.ts';
import { cx } from '../commun/classes.ts';
import s from './AvatarSession.module.css';
import { COULEURS_ETATS } from './Point.tsx';

/** Tailles : `grand` (en-tête du panneau Contexte), `rail` (moitié de la largeur du rail vertical), `barre` (même part de la hauteur d'une barre de titre). */
export type TailleAvatarSession = 'grand' | 'rail' | 'barre';

const DESSIN: Record<TailleAvatarSession, 12 | 16 | 48> = { grand: 48, rail: 16, barre: 12 };

export function AvatarSession(p: { session: Pick<SessionVue, 'profil' | 'etat' | 'attentePremierMessage'>; taille: TailleAvatarSession }): ReactNode {
	const avatarDe = useAvatarsDeProfils();
	const avatar = avatarDe(p.session.profil);
	const style = { '--profil': JETONS_COULEUR[avatar.couleur], '--etat': COULEURS_ETATS[p.session.etat] } as CSSProperties;
	const libelle = libelleEtat(p.session);
	return (
		<span className={cx(s.tuile, s[p.taille])} data-etat={p.session.etat} style={style}>
			<AvatarProfil avatar={avatar} taille={DESSIN[p.taille]} titre={`Profil ${p.session.profil}`} sansFond />
			<span className={s.pastille} role="img" aria-label={libelle} title={libelle} />
		</span>
	);
}
