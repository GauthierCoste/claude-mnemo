/**
 * Un choix multiple en interrupteurs, un par choix (libellé à gauche, interrupteur à droite). `inverse` : allumé quand le
 * choix n'est pas dans la valeur (« L'archiviste écrit seul… » : allumé = type absent de `archiviste.typesAConfirmer`).
 * La valeur garde l'ordre des choix du service.
 */
import type { ChampReglageVue } from '@mnemo/contrat';
import type { ReactNode } from 'react';
import type { Saisie } from '../../../reglages/brouillon.ts';
import type { ChampDispose } from '../../../reglages/disposition.ts';
import { Bascule } from '../../commun/Bascule.tsx';
import c from '../Cartes.module.css';
import { BadgeEffet, Defaut } from './Defaut.tsx';

export function Interrupteurs(p: { champ: ChampReglageVue; dispose: ChampDispose; saisie: Saisie; surSaisie(v: Saisie): void }): ReactNode {
	const coches = Array.isArray(p.saisie) ? p.saisie : [];
	const choix = p.champ.choix ?? [];
	const basculer = (valeur: string) => {
		const avec = !coches.includes(valeur);
		p.surSaisie(choix.map((x) => x.valeur).filter((v) => (v === valeur ? avec : coches.includes(v))));
	};
	return (
		<div role="group" aria-label={p.dispose.libelle} title={p.champ.explication}>
			<BadgeEffet champ={p.champ} />
			{choix.map((x) => (
				<div key={x.valeur} className={c.bascule}>
					<span className={c.libelleBascule} aria-hidden="true">
						{x.libelle}
					</span>
					<Bascule actif={p.dispose.inverse === true ? !coches.includes(x.valeur) : coches.includes(x.valeur)} surChangement={() => basculer(x.valeur)}>
						<span className={c.horsEcran}>{x.libelle}</span>
					</Bascule>
				</div>
			))}
			<Defaut champ={p.champ} saisie={p.saisie} surSaisie={p.surSaisie} />
		</div>
	);
}
