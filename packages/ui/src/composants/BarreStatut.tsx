import type { ReactNode } from 'react';
import type { EtatConnexion } from '../client/connexion.ts';
import type { SanteVue } from '@mnemo/contrat';
import { useTextes } from '../langue/langue.tsx';
import s from './BarreStatut.module.css';

/** Barre d'état (`.status`) : coffre, nombre de fiches, terminaux, connexion, version. */
export function BarreStatut(p: { sante: SanteVue | undefined; fiches: number | undefined; connexion: EtatConnexion }): ReactNode {
	const t = useTextes();
	const b = t.coquille.barreStatut;
	const terminaux = p.sante ? (p.sante.terminaux.ok ? b.terminauxDisponibles : b.sansTerminaux(p.sante.terminaux.motif)) : null;
	return (
		<footer className={s.statut}>
			{p.sante && <span>{b.coffre(p.sante.racine)}</span>}
			{p.fiches !== undefined && <span>{t.commun.formats.fiches(p.fiches)}</span>}
			<span className={s.espace} />
			{terminaux && <span>{terminaux}</span>}
			<span className={p.connexion === 'ouverte' ? undefined : s.alerte}>{b.connexion[p.connexion]}</span>
			{p.sante && <span>mnemo {p.sante.version}</span>}
		</footer>
	);
}
