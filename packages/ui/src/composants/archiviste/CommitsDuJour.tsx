import type { SessionVue } from '@mnemo/contrat';
import type { ReactNode } from 'react';
import type { FilVue } from '@mnemo/contrat';
import { PROFIL_ARCHIVISTE } from '@mnemo/commun';
import { messageCourt } from '../../archiviste/commits.ts';
import { useTextes } from '../../langue/langue.tsx';
import { cx } from '../commun/classes.ts';
import { Puce } from '../commun/Puce.tsx';
import s from './CommitsDuJour.module.css';

export type CommitVue = FilVue['commits'][number];

/** Puce de la session d'un commit : son objectif (couleur de son état), l'archiviste, ou « hors session ». */
export function PuceSession(p: { id: string | null; sessions: readonly SessionVue[] }): ReactNode {
	const t = useTextes().archiviste.commits;
	if (p.id === null) return <Puce>{t.horsSession}</Puce>;
	const session = p.sessions.find((x) => x.id === p.id);
	if (!session) return <Puce title={p.id}>{t.session(p.id.slice(0, 4))}</Puce>;
	if (session.profil === PROFIL_ARCHIVISTE) return <Puce couleur="violet">{t.archiviste}</Puce>;
	return (
		<Puce couleur={session.etat} className={s.puceSession} title={session.objectif ?? undefined}>
			{session.objectif ?? t.session(session.id.slice(0, 4))}
		</Puce>
	);
}

/** « Appris aujourd'hui » : les commits du jour, le plus récent d'abord. */
export function CommitsDuJour(p: { commits: readonly CommitVue[]; choisi: string | null; sessions: readonly SessionVue[]; choisir(hash: string): void }): ReactNode {
	const textes = useTextes();
	return (
		<ul className={s.liste} aria-label={textes.archiviste.commits.liste}>
			{p.commits.map((c) => (
				<li key={c.hash}>
					<button type="button" className={cx(s.commit, c.hash === p.choisi && s.on)} aria-pressed={c.hash === p.choisi} onClick={() => p.choisir(c.hash)}>
						<span className={s.heure}>{textes.commun.formats.heure(c.dateMs)}</span>
						<span className={s.message}>{messageCourt(c.message)}</span>
						<span className={s.infos}>
							{textes.archiviste.commits.fiches(c.fiches.length)} <PuceSession id={c.session} sessions={p.sessions} />
						</span>
					</button>
				</li>
			))}
		</ul>
	);
}
