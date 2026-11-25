import type { EtatSessionVue } from '@mnemo/contrat';
import type { CSSProperties, ReactNode } from 'react';
import { LIBELLES_ETATS } from '../../sessions/etats.ts';
import { cx } from '../commun/classes.ts';
import s from './Point.module.css';

/** Jeton de couleur de chaque état (écrit en clair : le test des jetons les voit tous). */
export const COULEURS_ETATS: Record<EtatSessionVue, string> = {
	attend: 'var(--etat-attend)',
	travaille: 'var(--etat-travaille)',
	a_relire: 'var(--etat-a-relire)',
	en_pause: 'var(--etat-en-pause)',
	terminee: 'var(--etat-terminee)',
};

/** Point d'état d'une session : pulse quand elle travaille ; son nom est le libellé de l'état. */
export function Point(p: { etat: EtatSessionVue; petit?: boolean }): ReactNode {
	const libelle = LIBELLES_ETATS[p.etat];
	return (
		<span
			role="img"
			aria-label={libelle}
			title={libelle}
			className={cx(s.point, p.etat === 'travaille' && s.anime, p.petit && s.petit)}
			style={{ '--c': COULEURS_ETATS[p.etat] } as CSSProperties}
		/>
	);
}
