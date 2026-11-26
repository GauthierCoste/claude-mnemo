/** Modèles connus d'un moteur (liste indicative du service) ; vide : seulement son modèle par défaut. */
import type { ReactNode } from 'react';
import s from './Moteurs.module.css';

export function ModelesMoteur(p: { moteur: string; modeles: readonly string[] }): ReactNode {
	return (
		<div>
			<h5 className={s.titreBloc}>Modèles</h5>
			{p.modeles.length === 0 ? (
				<span className={s.vide}>Son modèle par défaut</span>
			) : (
				<ul className={s.modeles} aria-label={`Modèles de ${p.moteur}`}>
					{p.modeles.map((m) => (
						<li key={m}>{m}</li>
					))}
				</ul>
			)}
		</div>
	);
}
