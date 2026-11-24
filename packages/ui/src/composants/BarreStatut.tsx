import type { ReactNode } from 'react';
import type { EtatConnexion } from '../client/connexion.ts';
import type { SanteVue } from '@mnemo/contrat';
import s from './BarreStatut.module.css';

const LIBELLES_CONNEXION: Record<EtatConnexion, string> = {
	connexion: 'connexion au service…',
	ouverte: 'service connecté',
	reconnexion: 'service arrêté',
	jeton_refuse: 'jeton refusé',
};

/** Barre d'état (`.status`) : coffre, nombre de fiches, terminaux, connexion, version. */
export function BarreStatut(p: { sante: SanteVue | undefined; fiches: number | undefined; connexion: EtatConnexion }): ReactNode {
	const terminaux = p.sante ? (p.sante.terminaux.ok ? 'terminaux disponibles' : `sans terminaux : ${p.sante.terminaux.motif}`) : null;
	return (
		<footer className={s.statut}>
			{p.sante && <span>coffre {p.sante.racine}</span>}
			{p.fiches !== undefined && <span>{p.fiches} fiches</span>}
			<span className={s.espace} />
			{terminaux && <span>{terminaux}</span>}
			<span className={p.connexion === 'ouverte' ? undefined : s.alerte}>{LIBELLES_CONNEXION[p.connexion]}</span>
			{p.sante && <span>mnemo {p.sante.version}</span>}
		</footer>
	);
}
