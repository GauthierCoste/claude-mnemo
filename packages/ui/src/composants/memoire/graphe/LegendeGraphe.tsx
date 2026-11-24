/**
 * Légende et filtre (panneau `.ov` du bas à gauche) : une case par type de lien, avec son trait ;
 * puis une entrée par catégorie du mode de couleur, avec son nombre de fiches ; clic : ne garder que celles-là
 * (plusieurs à la fois), re-clic : retirer.
 */
import type { ReactNode } from 'react';
import { LIBELLES_TYPES_DE_LIEN, TYPES_DE_LIEN, type EntreeLegende, type TypeDeLien } from '../../../graphe/donnees.ts';
import { cx } from '../../commun/classes.ts';
import s from './LegendeGraphe.module.css';
import { Pastille } from './Pastille.tsx';

/** Trait de chaque type de lien, le même que dans la scène (`scene.ts`) : parenté en tirets, lien personnalisé plein. */
const TRAITS: Record<TypeDeLien, string> = { parente: s.traitParente!, personnalise: s.traitPersonnalise! };

export function LegendeGraphe(p: {
	legende: EntreeLegende[];
	choisies: Set<string>;
	surChoix(cle: string): void;
	surToutAfficher(): void;
	typesCoches: ReadonlySet<TypeDeLien>;
	surType(type: TypeDeLien): void;
}): ReactNode {
	const choixActifs = p.choisies.size > 0;
	return (
		<div className={s.legende} role="group" aria-label="Légende et filtre" onWheel={(e) => e.stopPropagation()}>
			<div className={s.types} role="group" aria-label="Types de lien">
				{TYPES_DE_LIEN.map((type) => (
					<label key={type} className={s.entree}>
						<input type="checkbox" checked={p.typesCoches.has(type)} onChange={() => p.surType(type)} />
						<span className={cx(s.trait, TRAITS[type])} aria-hidden="true" />
						<span>{LIBELLES_TYPES_DE_LIEN[type]}</span>
					</label>
				))}
			</div>
			{p.legende.map((entree) => {
				const choisie = p.choisies.has(entree.cle);
				return (
					<button
						key={entree.cle}
						type="button"
						className={cx(s.entree, choisie && s.choisie, !choisie && choixActifs && s.ecartee)}
						aria-pressed={choisie}
						onClick={() => p.surChoix(entree.cle)}
					>
						<Pastille couleur={entree.couleur} />
						<span>{entree.nom}</span>
						<span className={s.nombre}>{entree.nombre.toLocaleString('fr-FR')}</span>
					</button>
				);
			})}
			{choixActifs && (
				<button type="button" className={cx(s.entree, s.tout)} onClick={p.surToutAfficher}>
					Tout afficher
				</button>
			)}
		</div>
	);
}
