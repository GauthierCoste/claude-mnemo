/**
 * « Appris aujourd'hui » (Mémoire › Archiviste, colonne « Enrichir ») : le jour (aujourd'hui par
 * défaut, qui suit la date après minuit), ses commits de la mémoire, le détail du commit choisi, et ce que l'archiviste a
 * fourni aux sessions depuis l'ouverture. Tout se relit du `Fil` du service, rechargé à chaque message `memoire`.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useAujourdhui, useFil, useServisRecus, useSessionsConnues } from '../../client/hooks.ts';
import { activiteArchiviste, ActiviteArchiviste } from './ActiviteArchiviste.tsx';
import s from './ApprisAujourdhui.module.css';
import { CommitsDuJour } from './CommitsDuJour.tsx';
import { DetailCommit } from './DetailCommit.tsx';

export function ApprisAujourdhui(): ReactNode {
	const aujourdhui = useAujourdhui();
	// null : « aujourd'hui », qui suit la date après minuit.
	const [jourChoisi, setJourChoisi] = useState<string | null>(null);
	const jour = jourChoisi ?? aujourdhui;
	const fil = useFil(jour);
	const sessions = useSessionsConnues();
	const servis = useServisRecus();
	const commits = useMemo(() => [...(fil.donnees?.commits ?? [])].sort((a, b) => b.dateMs - a.dateMs), [fil.donnees]);
	const activite = useMemo(() => activiteArchiviste(servis, [], sessions), [servis, sessions]);
	const [choisi, setChoisi] = useState<string | null>(null);
	const commit = commits.find((c) => c.hash === choisi) ?? commits[0] ?? null;

	return (
		<section className={s.appris} aria-labelledby="titre-appris">
			<div className={s.entete}>
				<h3 id="titre-appris" className={s.lbl}>
					<label htmlFor="appris-jour">Appris le</label>
				</h3>
				<input
					id="appris-jour"
					type="date"
					aria-label="Jour"
					className={s.jour}
					value={jour}
					max={aujourdhui}
					onChange={(e) => {
						if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) {
							setJourChoisi(e.target.value === aujourdhui ? null : e.target.value);
							setChoisi(null);
						}
					}}
				/>
			</div>
			{fil.donnees?.tronque === true && <p className={s.avis}>Plus de 500 changements ce jour-là : seuls les plus récents sont affichés</p>}
			{fil.erreur && (fil.donnees ? <p className={s.avis}>Fil non rechargé : {fil.erreur}</p> : <p className={s.avis}>Fil illisible : {fil.erreur}</p>)}
			{fil.donnees && commits.length === 0 && <p className={s.vide}>Aucun changement de la mémoire ce jour-là.</p>}
			<CommitsDuJour commits={commits} choisi={commit?.hash ?? null} sessions={sessions} choisir={setChoisi} />
			{commit && <DetailCommit commit={commit} sessions={sessions} />}
			<h3 className={s.lbl}>Ce qu'il a fait pour les sessions</h3>
			<ActiviteArchiviste activite={activite} libelle="Ce qu'il a fait pour les sessions" />
		</section>
	);
}
