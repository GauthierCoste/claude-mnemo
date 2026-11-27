/**
 * Une fiche candidate de l'écran de jugement : titre, première ligne, synthèse dépliable ; à droite, trois choix (groupe radio
 * natif : ←/→ et Tab comme partout) « Utile », « Pas utile », « Je ne sais pas ». La proposition du juge Claude est marquée
 * « Claude » sur son choix (pré-sélectionné s'il n'y avait pas de jugement), sa raison et sa confiance en bulle et sur une
 * ligne discrète sous la fiche.
 */
import type { CandidateAJugerVue, JugementVue } from '@mnemo/contrat';
import { useId, type ReactNode } from 'react';
import { JUGEMENTS, propositionEnClair } from '../../../memoire/jugement.ts';
import { useTextes } from '../../../langue/langue.tsx';
import { cx } from '../../commun/classes.ts';
import s from './JugerMessage.module.css';

export function FicheAJuger(p: { candidate: CandidateAJugerVue; choix: JugementVue | undefined; inerte: boolean; surChoix(j: JugementVue): void }): ReactNode {
	const t = useTextes().memoire.entrainer;
	const c = p.candidate;
	const id = useId();
	const proposition = c.proposition;
	const enClair = proposition === null ? null : propositionEnClair(proposition, t);
	return (
		<li className={s.fiche} data-fiche={c.chemin}>
			<div className={s.texteFiche}>
				<span id={`${id}-titre`} className={s.titreFiche} title={c.chemin}>
					{c.titre}
				</span>
				{c.ligne !== '' && <span className={s.ligneFiche}>{c.ligne}</span>}
				{enClair !== null && (
					<span id={`${id}-claude`} className={s.raison} title={enClair}>
						{enClair}
					</span>
				)}
				{c.synthese !== '' && (
					<details className={s.synthese}>
						<summary>{t.jugement.synthese}</summary>
						<p>{c.synthese}</p>
					</details>
				)}
			</div>
			<div role="radiogroup" className={s.choix} aria-labelledby={`${id}-titre`} aria-describedby={enClair === null ? undefined : `${id}-claude`}>
				{JUGEMENTS.map((j) => {
					const propose = proposition?.jugement === j;
					return (
						<label key={j} className={cx(s.option, propose && s.proposee)} data-jugement={j} title={propose && enClair !== null ? enClair : undefined}>
							<input type="radio" name={`${id}-choix`} value={j} checked={p.choix === j} disabled={p.inerte} onChange={() => p.surChoix(j)} />
							<span>{t.jugement.noms[j]}</span>
							{propose && (
								<span className={s.marque} aria-hidden="true">
									Claude
								</span>
							)}
						</label>
					);
				})}
			</div>
		</li>
	);
}
