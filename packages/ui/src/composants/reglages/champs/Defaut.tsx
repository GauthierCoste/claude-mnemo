/**
 * Ce qui accompagne chaque champ de l'onglet Réglages : « Défaut : x · Rétablir », seulement quand la saisie diffère du
 * défaut ; et le badge d'effet (redémarrage du service requis, prochain démarrage des modèles, variable d'environnement qui
 * l'emporte), quand une modification ne vaut pas tout de suite.
 */
import type { ChampReglageVue } from '@mnemo/contrat';
import type { ReactNode } from 'react';
import { useTextes } from '../../../langue/langue.tsx';
import { egales, enSaisie, enValeur, valeurLisible, type Saisie } from '../../../reglages/brouillon.ts';
import c from '../Cartes.module.css';

/** `lisible` : le défaut dit autrement que par la valeur du service (interrupteurs inversés : ceux allumés par défaut). */
export function Defaut(p: { champ: ChampReglageVue; saisie: Saisie; surSaisie(v: Saisie): void; lisible?: string }): ReactNode {
	const t = useTextes();
	const mots = t.reglages.champ;
	const champ = p.champ;
	if (egales(enValeur(champ, p.saisie), champ.defaut)) return null;
	return (
		<p className={c.defaut}>
			{mots.defaut(
				p.lisible ?? valeurLisible(champ, champ.defaut, t),
				<button type="button" className={c.lien} aria-label={mots.retablirDefaut(champ.libelle)} onClick={() => p.surSaisie(enSaisie(champ, champ.defaut))}>
					{mots.retablir}
				</button>,
			)}
		</p>
	);
}

export function BadgeEffet(p: { champ: ChampReglageVue }): ReactNode {
	const mots = useTextes().reglages.champ;
	const effet = p.champ.effet === 'immediat' ? null : mots.effets[p.champ.effet];
	const texte = p.champ.fixePar === undefined ? effet : mots.fixePar(p.champ.fixePar);
	if (texte === null) return null;
	const titre = p.champ.fixePar === undefined ? undefined : mots.fixeParDetail(p.champ.fixePar);
	return (
		<span className={c.badge} title={titre}>
			{texte}
		</span>
	);
}
