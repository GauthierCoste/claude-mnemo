/**
 * Une carte de réglages de l'onglet Réglages (Rappel, Confiance, Système), d'après sa disposition (`reglages/disposition.ts`) :
 * titre, sous-titre, puis ses groupes ; chaque champ dans sa forme (curseur, barre, liste déroulante, nombre, interrupteurs,
 * puces, nuancier). Un champ absent de la vue du service n'est pas montré ; un groupe sans champ non plus. Les barres qui se
 * suivent partagent une grille ; « Réglages fins » est replié, avec son nombre de réglages.
 */
import type { ChampReglageVue } from '@mnemo/contrat';
import { useId, type ReactNode } from 'react';
import type { Saisie } from '../../reglages/brouillon.ts';
import type { CarteDisposee, ChampDispose, GroupeDispose } from '../../reglages/disposition.ts';
import { BadgeEffet, Defaut } from './champs/Defaut.tsx';
import { Barre, Curseur } from './champs/Glissieres.tsx';
import { Interrupteurs } from './champs/Interrupteurs.tsx';
import { Nuancier } from './champs/Nuancier.tsx';
import { Puces } from './champs/Puces.tsx';
import c from './Cartes.module.css';

export type Saisies = {
	champs: readonly ChampReglageVue[];
	saisies: Readonly<Record<string, Saisie>>;
	surSaisie(cle: string, v: Saisie): void;
	/** Valeur numérique saisie d'un champ (phrases d'effet qui dépendent d'un autre champ). */
	valeurDe(cle: string): number | undefined;
};

/** `etatService` : la ligne d'état du service, en tête du groupe qui la demande ; `enPlus` : champs ajoutés aux Réglages fins. */
export function CarteReglages(p: { carte: CarteDisposee; s: Saisies; etatService?: ReactNode; enPlus?: readonly ChampDispose[] }): ReactNode {
	const id = useId();
	const groupes = p.carte.groupes
		.map((g) => (g.repli === true && p.enPlus !== undefined ? { ...g, champs: [...g.champs, ...p.enPlus] } : g))
		.map((g) => ({ ...g, champs: g.champs.filter((x) => p.s.champs.some((ch) => ch.cle === x.cle)) }))
		.filter((g) => g.champs.length > 0 || g.etatService === true);
	return (
		<section className={c.carte} aria-labelledby={`${id}-titre`}>
			<h2 id={`${id}-titre`} className={c.titreCarte}>
				{p.carte.titre}
			</h2>
			<p className={c.sous}>{p.carte.sous}</p>
			{groupes.map((g) => (
				<Groupe key={g.titre ?? ''} groupe={g} s={p.s} etatService={g.etatService === true ? p.etatService : undefined} />
			))}
		</section>
	);
}

function Groupe(p: { groupe: GroupeDispose; s: Saisies; etatService: ReactNode }): ReactNode {
	const g = p.groupe;
	const champs = <Champs champs={g.champs} s={p.s} ton={g.ton} />;
	if (g.repli === true) {
		return (
			<div className={c.groupe}>
				<details className={c.fins}>
					<summary>
						{g.titre} · {g.champs.length}
					</summary>
					{champs}
				</details>
			</div>
		);
	}
	return (
		<div className={c.groupe} role="group" aria-label={g.titre ?? undefined}>
			{g.titre !== null && <h3 className={c.titreGroupe}>{g.titre}</h3>}
			{p.etatService}
			{champs}
		</div>
	);
}

/** Les champs d'un groupe dans l'ordre ; les barres qui se suivent dans une même grille. */
function Champs(p: { champs: readonly ChampDispose[]; s: Saisies; ton: GroupeDispose['ton'] }): ReactNode {
	const paquets: ChampDispose[][] = [];
	for (const x of p.champs) {
		const dernier = paquets.at(-1);
		if (x.forme === 'barre' && dernier?.[0]?.forme === 'barre') dernier.push(x);
		else paquets.push([x]);
	}
	return paquets.map((paquet) =>
		paquet[0]!.forme === 'barre' ? (
			<div key={paquet[0]!.cle} className={c.barres} data-ton={p.ton}>
				{paquet.map((x) => (
					<Champ key={x.cle} dispose={x} s={p.s} />
				))}
			</div>
		) : (
			<Champ key={paquet[0]!.cle} dispose={paquet[0]!} s={p.s} />
		),
	);
}

function Champ(p: { dispose: ChampDispose; s: Saisies }): ReactNode {
	const champ = p.s.champs.find((x) => x.cle === p.dispose.cle);
	const saisie = p.s.saisies[p.dispose.cle];
	if (champ === undefined || saisie === undefined) return null;
	const props = { champ, dispose: p.dispose, saisie, surSaisie: (v: Saisie) => p.s.surSaisie(champ.cle, v) };
	switch (p.dispose.forme) {
		case 'curseur':
			return <Curseur {...props} valeurDe={p.s.valeurDe} />;
		case 'barre':
			return <Barre {...props} valeurDe={p.s.valeurDe} />;
		case 'interrupteurs':
			return <Interrupteurs {...props} />;
		case 'puces':
			return <Puces {...props} />;
		case 'couleur':
			return <Nuancier {...props} />;
		case 'choix':
		case 'nombre':
			return <Ligne {...props} />;
	}
}

/** Une ligne libellé (et sa petite aide) à gauche, liste déroulante ou nombre à droite ; le défaut dessous. */
function Ligne(p: { champ: ChampReglageVue; dispose: ChampDispose; saisie: Saisie; surSaisie(v: Saisie): void }): ReactNode {
	const id = useId();
	const texte = typeof p.saisie === 'string' ? p.saisie : '';
	return (
		<div className={c.bascule}>
			<span className={c.libelleBascule}>
				<label htmlFor={id} title={p.champ.explication}>
					{p.dispose.libelle}
				</label>
				{p.dispose.aide !== undefined && <small>{p.dispose.aide}</small>}
			</span>
			<BadgeEffet champ={p.champ} />
			{p.dispose.forme === 'choix' ? (
				<select id={id} className={c.choix} value={texte} onChange={(e) => p.surSaisie(e.target.value)}>
					{(p.champ.choix ?? []).map((x) => (
						<option key={x.valeur} value={x.valeur}>
							{x.libelle}
						</option>
					))}
				</select>
			) : (
				<input id={id} className={c.nombre} type="number" inputMode="numeric" min={p.champ.min} max={p.champ.max} step={1} value={texte} onChange={(e) => p.surSaisie(e.target.value)} />
			)}
			<Defaut champ={p.champ} saisie={p.saisie} surSaisie={p.surSaisie} />
		</div>
	);
}
