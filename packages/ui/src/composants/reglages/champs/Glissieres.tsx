/**
 * Les deux glissières de l'onglet Réglages, pour un nombre (entier ou décimal) : le curseur parlant (libellé, valeur à
 * droite, glissière, phrase d'effet, défaut) et la barre compacte (libellé, glissière et valeur sur une ligne : fiabilités,
 * poids, réglages fins). Bornes et défaut viennent du service ; l'explication du service est l'infobulle du libellé.
 */
import type { ChampReglageVue } from '@mnemo/contrat';
import { useId, type ReactNode } from 'react';
import { enValeur, valeurLisible, type Saisie } from '../../../reglages/brouillon.ts';
import type { ChampDispose } from '../../../reglages/disposition.ts';
import { useEntrainement } from '../../../client/hooks.ts';
import { phraseEffet, remarqueSeuilInjection } from '../../../reglages/phrases-effet.ts';
import c from '../Cartes.module.css';
import { BadgeEffet, Defaut } from './Defaut.tsx';

type Props = { champ: ChampReglageVue; dispose: ChampDispose; saisie: Saisie; surSaisie(v: Saisie): void; valeurDe(cle: string): number | undefined };

/** La saisie en nombre ; illisible : le défaut (la glissière ne montre qu'un nombre). */
function nombreDe(champ: ChampReglageVue, saisie: Saisie): number {
	const v = enValeur(champ, saisie);
	return typeof v === 'number' ? v : Number(champ.defaut);
}

/** Nombre saisi par la glissière, écrit comme dans un champ texte (virgule décimale). */
const enTexte = (champ: ChampReglageVue, n: number): string => (champ.genre === 'decimal' ? String(n).replace('.', ',') : String(n));

/** Attributs de la glissière : bornes du service, pas d'un centième pour un décimal ; lue comme la valeur affichée. */
function glissiere(p: Props, id: string, affichee: string) {
	const n = nombreDe(p.champ, p.saisie);
	return {
		id,
		'aria-valuetext': affichee,
		type: 'range',
		min: p.champ.min ?? 0,
		max: p.champ.max ?? (p.champ.genre === 'decimal' ? 1 : 100),
		step: p.champ.genre === 'decimal' ? 0.01 : 1,
		value: n,
		onChange: (e: { target: { value: string } }) => p.surSaisie(enTexte(p.champ, Number(e.target.value))),
	} as const;
}

export function Curseur(p: Props): ReactNode {
	const id = useId();
	const n = nombreDe(p.champ, p.saisie);
	const phrase = phraseEffet(p.champ.cle, n, p.valeurDe);
	const affichee = p.dispose.format?.(n) ?? valeurLisible(p.champ, n);
	return (
		<div className={c.curseur}>
			<span className={c.libelle}>
				<label htmlFor={id} title={p.champ.explication}>
					{p.dispose.libelle}
				</label>
				<BadgeEffet champ={p.champ} />
			</span>
			<output htmlFor={id} className={c.valeur}>
				{affichee}
			</output>
			<input {...glissiere(p, id, affichee)} />
			{phrase !== null && (
				<p className={c.effet} role="status">
					{phrase}
				</p>
			)}
			{p.champ.cle === 'contexte.seuilInjection' && <RemarqueSeuil n={n} />}
			<Defaut champ={p.champ} saisie={p.saisie} surSaisie={p.surSaisie} />
		</div>
	);
}

/** Sous le seuil d'injection : ce qu'il fait vraiment, selon la note de confiance (sans effet tant qu'elle est refusée). */
function RemarqueSeuil(p: { n: number }): ReactNode {
	const remarque = remarqueSeuilInjection(p.n, useEntrainement().donnees?.note.niveaux);
	return remarque === null ? null : <p className={c.remarque}>{remarque}</p>;
}

export function Barre(p: Props): ReactNode {
	const id = useId();
	const n = nombreDe(p.champ, p.saisie);
	const affichee = p.champ.genre === 'decimal' ? n.toFixed(2).replace('.', ',') : String(n);
	return (
		<div className={c.barre}>
			<label htmlFor={id} title={`${p.dispose.libelle} : ${p.champ.explication}`}>
				{p.dispose.libelle}
			</label>
			<input {...glissiere(p, id, affichee)} />
			<output htmlFor={id} className={c.valeur}>
				{affichee}
			</output>
			<BadgeEffet champ={p.champ} />
			<Defaut champ={p.champ} saisie={p.saisie} surSaisie={p.surSaisie} />
		</div>
	);
}
