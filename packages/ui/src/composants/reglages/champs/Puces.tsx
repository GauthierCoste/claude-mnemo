/**
 * Une liste de noms en puces (marqueurs de projet) : × retire un nom, « + ajouter » ouvre une saisie en place (Entrée ou
 * sortie du champ ajoute, Échap annule ; un nom déjà présent, casse ignorée, n'est pas ajouté deux fois).
 */
import type { ChampReglageVue } from '@mnemo/contrat';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { enValeur, type Saisie } from '../../../reglages/brouillon.ts';
import type { ChampDispose } from '../../../reglages/disposition.ts';
import c from '../Cartes.module.css';
import { BadgeEffet, Defaut } from './Defaut.tsx';

export function Puces(p: { champ: ChampReglageVue; dispose: ChampDispose; saisie: Saisie; surSaisie(v: Saisie): void }): ReactNode {
	const v = enValeur(p.champ, p.saisie);
	const noms = Array.isArray(v) ? v : [];
	const [ajout, setAjout] = useState<string | null>(null);
	const ecrire = (liste: string[]) => p.surSaisie(liste.join(', '));
	const ajouter = () => {
		const nom = (ajout ?? '').trim();
		setAjout(null);
		if (nom === '' || noms.some((x) => x.toLocaleLowerCase() === nom.toLocaleLowerCase())) return;
		ecrire([...noms, nom]);
	};
	const clavier = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			ajouter();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			setAjout(null);
		}
	};
	return (
		<div title={p.champ.explication}>
			<BadgeEffet champ={p.champ} />
			<ul className={c.puces} aria-label={p.dispose.libelle}>
				{noms.map((nom) => (
					<li key={nom} className={c.puce}>
						{nom}
						<button type="button" aria-label={`Retirer ${nom}`} onClick={() => ecrire(noms.filter((x) => x !== nom))}>
							×
						</button>
					</li>
				))}
				<li>
					{ajout === null ? (
						<button type="button" className={c.ajout} onClick={() => setAjout('')}>
							+ ajouter
						</button>
					) : (
						<input
							className={c.saisiePuce}
							aria-label={`Ajouter : ${p.dispose.libelle}`}
							placeholder="ex. Makefile"
							spellCheck={false}
							autoFocus
							value={ajout}
							onChange={(e) => setAjout(e.target.value)}
							onKeyDown={clavier}
							onBlur={ajouter}
						/>
					)}
				</li>
			</ul>
			<Defaut champ={p.champ} saisie={p.saisie} surSaisie={p.surSaisie} />
		</div>
	);
}
