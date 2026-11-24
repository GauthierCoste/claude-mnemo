import type { SessionVue } from '@mnemo/contrat';
import type { ReactNode } from 'react';
import { useNavigation } from '../../navigation.tsx';
import { titreFiche } from '../../sessions/servis.ts';
import { Puce } from '../commun/Puce.tsx';
import { heure } from '../../archiviste/commits.ts';
import { useOuvrirSession } from '../sessions/ouvrir-session.ts';
import { PuceSession, type CommitVue } from './CommitsDuJour.tsx';
import s from './DetailCommit.module.css';

/**
 * Détail du commit choisi dans « Appris aujourd'hui » (Mémoire › Archiviste) : message, heure,
 * empreinte, la session qui l'a écrit (ouverte par `useOuvrirSession`, terminée ou archiviste compris) et les fiches touchées
 * (→ Mémoire › Fichiers).
 */
export function DetailCommit(p: { commit: CommitVue | null; sessions: readonly SessionVue[] }): ReactNode {
	const nav = useNavigation();
	const ouvrirSession = useOuvrirSession();
	const c = p.commit;
	return (
		<section className={s.detail} aria-label="Commit choisi">
			<div className={s.entete}>
				{c ? (
					<>
						<b className={s.titre}>{c.message}</b>
						<Puce>{c.hash}</Puce>
					</>
				) : (
					<b className={s.titre}>Aucun commit choisi</b>
				)}
				<span className={s.espace} />
				{c && <span className={s.mu}>{heure(c.dateMs)}</span>}
			</div>
			<div className={s.corps}>
				{c && (
					<div>
						<div className={s.section}>
							<span className={s.lbl}>Écrit par</span>
							<div className={s.ligne}>
								{c.session !== null ? (
									<button type="button" className={s.lien} onClick={() => ouvrirSession(c.session!)}>
										<PuceSession id={c.session} sessions={p.sessions} />
										<span className={s.mu}>→ ouvrir</span>
									</button>
								) : (
									<PuceSession id={c.session} sessions={p.sessions} />
								)}
							</div>
						</div>
						<div className={s.section}>
							<span className={s.lbl}>
								{c.fiches.length} fiche{c.fiches.length > 1 ? 's' : ''} touchée{c.fiches.length > 1 ? 's' : ''}
							</span>
							<ul className={s.fiches}>
								{c.fiches.map((f) => (
									<li key={f}>
										<button type="button" className={s.fiche} onClick={() => nav.ouvrirFiche(f)} title={f}>
											<b>{titreFiche(f)}</b>
											<span className={s.chemin}>{f.split('/').slice(0, -1).join('/') || 'racine'}</span>
										</button>
									</li>
								))}
							</ul>
						</div>
					</div>
				)}
			</div>
		</section>
	);
}
