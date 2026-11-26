/**
 * Mission de la Nouvelle session : où (le dossier, replié en une ligne ; « Changer » déplie l'arbre, un dossier choisi le
 * replie ; figé pour un agent qui se lance dans la mémoire) et quoi (l'objectif, facultatif, borné à `OBJECTIF_MAX`).
 */
import { OBJECTIF_MAX } from '@mnemo/commun';
import { Fragment, useId, useState, type ReactNode } from 'react';
import { PLIAGE_INITIAL } from '../../../dossiers/arbre.ts';
import { ArbreDossiers } from '../../commun/ArbreDossiers.tsx';
import { Bouton } from '../../commun/Bouton.tsx';
import s from './MissionSession.module.css';

type Props = { dansLaMemoire: boolean; dossier: string; nomRacine: string; surDossier(chemin: string): void; objectif: string; surObjectif(objectif: string): void };

export function MissionSession(p: Props): ReactNode {
	const id = useId();
	const [ouvert, setOuvert] = useState(false);
	const [pliage, setPliage] = useState(PLIAGE_INITIAL);
	// la racine, puis chaque dossier du chemin
	const segments = [p.nomRacine, ...(p.dossier === '' ? [] : p.dossier.split('/'))];
	// l'arbre replié (un dossier choisi, ou « Replier ») : le focus revient à « Changer », qui reste à sa place
	const replier = () => {
		setOuvert(false);
		document.getElementById(`${id}-changer`)?.focus();
	};
	return (
		<div className={s.mission}>
			<div className={s.champ} role="group" aria-labelledby={`${id}-dossier`}>
				<span id={`${id}-dossier`} className={s.lbl}>
					Dossier
				</span>
				{p.dansLaMemoire ? (
					<p className={s.lieu} data-fige>
						Se lance dans la mémoire, quel que soit le dossier.
					</p>
				) : (
					<>
						<div className={s.lieu}>
							<span className={s.chemin} title={p.dossier === '' ? p.nomRacine : `${p.nomRacine}/${p.dossier}`}>
								{segments.map((x, i) => (
									<Fragment key={i}>
										{i > 0 && <span className={s.sep}> / </span>}
										{x}
									</Fragment>
								))}
							</span>
							<Bouton petit id={`${id}-changer`} className={s.cible} aria-expanded={ouvert} aria-controls={`${id}-arbre`} onClick={() => (ouvert ? replier() : setOuvert(true))}>
								{ouvert ? 'Replier' : 'Changer'}
							</Bouton>
						</div>
						{ouvert && (
							<div id={`${id}-arbre`} className={s.arbre} data-arbre>
								<ArbreDossiers
									presentation="cadre"
									entete={<span className={s.lbl}>Choisis le dossier</span>}
									choisi={p.dossier}
									surChoisir={(chemin) => {
										p.surDossier(chemin);
										replier();
									}}
									pliage={pliage}
									surPliage={setPliage}
									details={() => null}
								/>
							</div>
						)}
					</>
				)}
			</div>
			<label className={s.champ}>
				<span className={s.lbl}>Objectif (facultatif)</span>
				<input type="text" className={s.saisie} maxLength={OBJECTIF_MAX} value={p.objectif} onChange={(e) => p.surObjectif(e.target.value)} placeholder="Ce que la session doit faire" />
			</label>
		</div>
	);
}
