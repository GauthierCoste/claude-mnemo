import type { EntreeServieVue, SessionVue } from '@mnemo/contrat';
import { useId, type ReactNode } from 'react';
import type { FilVue } from '@mnemo/contrat';
import { PROFIL_ARCHIVISTE } from '@mnemo/commun';
import { dernierClassement, pourcentage } from '../../sessions/classement.ts';
import { fichesServies } from '../../sessions/servis.ts';
import { heure, messageCourt } from '../../archiviste/commits.ts';
import { DePlus, useToutPour } from '../commun/DePlus.tsx';
import s from './ActiviteArchiviste.module.css';

export const ACTIVITE_MAX = 20;

export type LigneActivite = { cle: string; ms: number; titre: string; detail: string };

/** Toutes les lignes, plus récentes d'abord ; l'affichage en montre `ACTIVITE_MAX`, puis `DePlus`. */
export type Activite = { lignes: LigneActivite[] };

function nomSession(id: string | null, sessions: readonly SessionVue[]): string {
	if (id === null) return 'Hors session';
	const x = sessions.find((y) => y.id === id);
	if (!x) return `Session ${id.slice(0, 4)}`;
	if (x.profil === PROFIL_ARCHIVISTE) return 'Archiviste';
	return x.objectif ?? `Session ${id.slice(0, 4)}`;
}

/** « 2 fiches injectées au démarrage, en tête : Titre (87 %) » : la tête du classement suit ses mises à jour (notes). */
function detailServi(e: EntreeServieVue): string {
	const n = fichesServies([e]).length;
	const fournies = `${n} fiche${n > 1 ? 's' : ''} injectée${n > 1 ? 's' : ''}${e.moment === 'debut' ? ' au démarrage' : ''}`;
	const [tete] = dernierClassement([e], []);
	if (tete === undefined) return fournies;
	const note = pourcentage(tete.note);
	return `${fournies}, en tête : ${tete.titre}${note === null ? '' : ` (${note})`}`;
}

/**
 * Activité de l'archiviste : les `servi` reçus depuis l'ouverture (« Ce qu'il a fait pour tes sessions », Mémoire ›
 * Archiviste) et les commits du fil du jour (activité minimale du tiroir), mêlés par date (plus récents d'abord).
 */
export function activiteArchiviste(servis: readonly EntreeServieVue[], commits: FilVue['commits'], sessions: readonly SessionVue[]): Activite {
	const lignes: LigneActivite[] = [
		...servis.map((e) => ({
			cle: `servi|${e.session}|${e.horodatageMs}|${e.ids.join(',')}`,
			ms: e.horodatageMs,
			titre: nomSession(e.session, sessions),
			detail: detailServi(e),
		})),
		...commits.map((c) => ({ cle: `commit|${c.hash}`, ms: c.dateMs, titre: nomSession(c.session, sessions), detail: messageCourt(c.message) })),
	];
	return { lignes: lignes.sort((a, b) => b.ms - a.ms) };
}

/** « Activité (N) », titre repliable du tiroir : N compté avant la coupure de l'affichage. */
export const libelleActivite = (a: Activite): string => `Activité (${a.lignes.length})`;

/** Activité de l'archiviste : heure, puis session et ce qui a été fait (le conteneur le fait défiler). */
export function ActiviteArchiviste(p: { activite: Activite; libelle: string }): ReactNode {
	// une clé propre à cette liste, stable tant qu'elle est affichée
	const { tout, toutVoir } = useToutPour(useId());
	const affichees = tout ? p.activite.lignes : p.activite.lignes.slice(0, ACTIVITE_MAX);
	return (
		<div className={s.activite}>
			<ul className={s.liste} aria-label={p.libelle}>
				{affichees.map((l) => (
					<li key={l.cle} className={s.ligne}>
						<span className={s.heure}>{heure(l.ms)}</span>
						<span className={s.quoi}>
							<span>{l.titre}</span>
							<em>{l.detail}</em>
						</span>
					</li>
				))}
			</ul>
			{p.activite.lignes.length === 0 && <p className={s.vide}>Rien encore aujourd'hui.</p>}
			<DePlus nombre={p.activite.lignes.length - affichees.length} surToutVoir={toutVoir} />
		</div>
	);
}
