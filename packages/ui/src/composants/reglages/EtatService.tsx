/**
 * Réglages › Système › Service : la ligne d'état du service qui sert cette interface (il répond : en marche), sa version et
 * son port enregistré ; un port changé mais pas encore en vigueur le dit.
 */
import type { ReactNode } from 'react';
import { useSante } from '../../client/hooks.ts';
import { useTextes } from '../../langue/langue.tsx';
import c from './Cartes.module.css';

export function EtatService(p: { port: string | undefined; portEnAttente: boolean }): ReactNode {
	const t = useTextes().reglages.service;
	const sante = useSante().donnees;
	const details = [sante === undefined ? null : t.version(sante.version), p.port === undefined ? null : t.port(p.port, p.portEnAttente)].filter((x) => x !== null);
	return (
		<div className={c.prise}>
			<span className={c.logo} aria-hidden="true">
				<span className={c.pouls} />
			</span>
			<span className={c.ident}>
				<span className={c.nom}>{t.enMarche}</span>
				<span className={c.detailLigne}>{details.join(' · ')}</span>
			</span>
		</div>
	);
}
