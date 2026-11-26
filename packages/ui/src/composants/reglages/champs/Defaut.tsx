/**
 * Ce qui accompagne chaque champ de l'onglet Réglages : « Défaut : x · Rétablir », seulement quand la saisie diffère du
 * défaut ; et le badge d'effet (redémarrage du service requis, prochain démarrage des modèles, variable d'environnement qui
 * l'emporte), quand une modification ne vaut pas tout de suite.
 */
import type { ChampReglageVue } from '@mnemo/contrat';
import type { ReactNode } from 'react';
import { egales, enSaisie, enValeur, valeurLisible, type Saisie } from '../../../reglages/brouillon.ts';
import c from '../Cartes.module.css';

const EFFETS: Readonly<Record<ChampReglageVue['effet'], string | null>> = {
	immediat: null,
	service: 'Redémarrage du service requis',
	modeles: 'Au prochain démarrage des modèles',
};

export function Defaut(p: { champ: ChampReglageVue; saisie: Saisie; surSaisie(v: Saisie): void }): ReactNode {
	const champ = p.champ;
	if (egales(enValeur(champ, p.saisie), champ.defaut)) return null;
	return (
		<p className={c.defaut}>
			Défaut : {valeurLisible(champ, champ.defaut)} ·{' '}
			<button type="button" className={c.lien} aria-label={`Rétablir le défaut : ${champ.libelle}`} onClick={() => p.surSaisie(enSaisie(champ, champ.defaut))}>
				Rétablir
			</button>
		</p>
	);
}

export function BadgeEffet(p: { champ: ChampReglageVue }): ReactNode {
	const texte = p.champ.fixePar === undefined ? EFFETS[p.champ.effet] : `Fixé par ${p.champ.fixePar}`;
	if (texte === null) return null;
	const titre = p.champ.fixePar === undefined ? undefined : `La variable d’environnement ${p.champ.fixePar} du service l’emporte sur ce réglage tant qu’elle est posée.`;
	return (
		<span className={c.badge} title={titre}>
			{texte}
		</span>
	);
}
