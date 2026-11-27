import type { SessionVue } from '@mnemo/contrat';
import type { ReactNode } from 'react';
import { useNavigation } from '../../navigation.tsx';
import { titreFiche } from '../../sessions/servis.ts';
import { Puce } from '../commun/Puce.tsx';
import { useTextes } from '../../langue/langue.tsx';
import { useOuvrirSession } from '../sessions/ouvrir-session.ts';
import { PuceSession, type CommitVue } from './CommitsDuJour.tsx';
import s from './DetailCommit.module.css';

/**
 * Détail du commit choisi dans « Appris aujourd'hui » (Mémoire › Archiviste) : message, heure,
 * empreinte, la session qui l'a écrit (ouverte par `useOuvrirSession`, terminée ou archiviste compris) et les fiches touchées
 * (→ Mémoire › Fichiers).
 */
export function DetailCommit(p: { commit: CommitVue | null; sessions: readonly SessionVue[] }): ReactNode {
	const textes = useTextes();
	const t = textes.archiviste.detail;
	const nav = useNavigation();
	const ouvrirSession = useOuvrirSession();
	const c = p.commit;
	return (
		<section className={s.detail} aria-label={t.libelle}>
			<div className={s.entete}>
				{c ? (
					<>
						<b className={s.titre}>{c.message}</b>
						<Puce>{c.hash}</Puce>
					</>
				) : (
					<b className={s.titre}>{t.aucun}</b>
				)}
				<span className={s.espace} />
				{c && <span className={s.mu}>{textes.commun.formats.heure(c.dateMs)}</span>}
			</div>
			<div className={s.corps}>
				{c && (
					<div>
						<div className={s.section}>
							<span className={s.lbl}>{t.ecritPar}</span>
							<div className={s.ligne}>
								{c.session !== null ? (
									<button type="button" className={s.lien} onClick={() => ouvrirSession(c.session!)}>
										<PuceSession id={c.session} sessions={p.sessions} />
										<span className={s.mu}>{t.ouvrir}</span>
									</button>
								) : (
									<PuceSession id={c.session} sessions={p.sessions} />
								)}
							</div>
						</div>
						<div className={s.section}>
							<span className={s.lbl}>
								{t.fichesTouchees(c.fiches.length)}
							</span>
							<ul className={s.fiches}>
								{c.fiches.map((f) => (
									<li key={f}>
										<button type="button" className={s.fiche} onClick={() => nav.ouvrirFiche(f)} title={f}>
											<b>{titreFiche(f)}</b>
											<span className={s.chemin}>{f.split('/').slice(0, -1).join('/') || t.racine}</span>
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
