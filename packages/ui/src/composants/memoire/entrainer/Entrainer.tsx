/**
 * Mémoire › Entraîner : entraîner sa note de confiance (spec « entraîner la note »). De haut en bas : l'état de la note
 * (`EnteteNote`), la tâche en cours (`TacheEntrainement`), l'erreur de la dernière tâche, les trois étapes
 * (`EtapesEntrainement`), le dernier apprentissage (`ResultatApprentissage`) et l'historique ; les deux derniers seulement
 * s'il y en a. « Juger » ouvre l'écran de jugement à la place, dans la page ; au retour, le focus va au bouton principal de
 * l'étape utile (« Apprendre la note » quand c'est elle).
 */
import { useId, useState, type ReactNode } from 'react';
import { useEntrainement } from '../../../client/hooks.ts';
import { Bouton } from '../../commun/Bouton.tsx';
import { EnteteNote } from './EnteteNote.tsx';
import s from './Entrainer.module.css';
import { EtapesEntrainement } from './EtapesEntrainement.tsx';
import { HistoriqueEntrainement } from './HistoriqueEntrainement.tsx';
import { JugerMessage } from './JugerMessage.tsx';
import { ResultatApprentissage } from './ResultatApprentissage.tsx';
import { TacheEntrainement } from './TacheEntrainement.tsx';

export function Entrainer(): ReactNode {
	const ressource = useEntrainement();
	const v = ressource.donnees;
	const [jugement, setJugement] = useState(false);
	// revenu de l'écran de jugement : le focus va au geste principal de l'étape utile (sinon il tomberait sur la page)
	const [revenu, setRevenu] = useState(false);
	const idTache = useId();

	if (v === undefined) {
		return (
			<div className={s.page}>
				<div className={s.colonne} aria-busy={ressource.erreur === null}>
					{ressource.erreur !== null ? (
						<p className={s.refus} role="alert">
							État de l’entraînement illisible : {ressource.erreur}{' '}
							<Bouton petit className={s.cible} onClick={ressource.recharger}>
								Relire
							</Bouton>
						</p>
					) : (
						<Squelette />
					)}
				</div>
			</div>
		);
	}
	return (
		<div className={s.page}>
			<div className={s.colonne}>
				{jugement ? (
					<JugerMessage
						surFermer={() => {
							setJugement(false);
							setRevenu(true);
						}}
					/>
				) : (
					<>
						<EnteteNote vue={v} />
						{v.tache !== null && <TacheEntrainement tache={v.tache} id={idTache} />}
						{v.derniereErreur !== undefined && v.tache === null && (
							<p className={s.erreurTache} role="alert">
								<span className={s.titreErreur}>La dernière tâche a échoué.</span> {v.derniereErreur}
							</p>
						)}
						<EtapesEntrainement vue={v} idTache={v.tache !== null ? idTache : null} focusAuRetour={revenu} surJuger={() => setJugement(true)} />
						{v.resultat !== null && <ResultatApprentissage resultat={v.resultat} />}
						{v.historique.length > 0 && <HistoriqueEntrainement lignes={v.historique} />}
					</>
				)}
			</div>
		</div>
	);
}

/** À la forme de la page : en-tête, puis les trois cartes des étapes. */
function Squelette(): ReactNode {
	return (
		<>
			<div className={s.squeletteEntete} />
			<div className={s.etapes}>
				<div className={s.squeletteCarte} />
				<div className={s.squeletteCarte} />
				<div className={s.squeletteCarte} />
			</div>
		</>
	);
}
