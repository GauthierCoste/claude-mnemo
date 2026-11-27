import type { EntreeServieVue, SessionVue } from '@mnemo/contrat';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { FilVue } from '@mnemo/contrat';
import { PROFIL_ARCHIVISTE } from '@mnemo/commun';
import { dernierClassement, pourcentage } from '../../sessions/classement.ts';
import { fichesServies } from '../../sessions/servis.ts';
import { messageCourt } from '../../archiviste/commits.ts';
import { useTextes } from '../../langue/langue.tsx';
import { TEXTES, type Textes } from '../../langue/textes.ts';
import { Bouton } from '../commun/Bouton.tsx';
import s from './ActiviteArchiviste.module.css';

export const ACTIVITE_MAX = 20;

export type LigneActivite = { cle: string; ms: number; titre: string; detail: string };

/** Toutes les lignes, plus récentes d'abord ; l'affichage les montre par tranches de `ACTIVITE_MAX`. */
export type Activite = { lignes: LigneActivite[] };

type TextesActivite = Textes['archiviste']['activite'];

function nomSession(id: string | null, sessions: readonly SessionVue[], t: TextesActivite): string {
	if (id === null) return t.horsSession;
	const x = sessions.find((y) => y.id === id);
	if (!x) return t.session(id.slice(0, 4));
	if (x.profil === PROFIL_ARCHIVISTE) return t.archiviste;
	return x.objectif ?? t.session(id.slice(0, 4));
}

/** « 2 fiches injectées au démarrage, en tête : Titre (87 %) » : la tête du classement suit ses mises à jour (notes). */
function detailServi(e: EntreeServieVue, t: TextesActivite, ts: Textes['sessions']): string {
	const fournies = t.injectees(fichesServies([e]).length, e.moment === 'debut');
	const [tete] = dernierClassement([e], []);
	if (tete === undefined) return fournies;
	return t.enTete(fournies, tete.titre, pourcentage(tete.note, ts));
}

/**
 * Activité de l'archiviste : les `servi` reçus depuis l'ouverture (« Ce qu'il a fait pour les sessions », Mémoire ›
 * Archiviste) et les commits du fil du jour (activité minimale du tiroir), mêlés par date (plus récents d'abord).
 */
export function activiteArchiviste(servis: readonly EntreeServieVue[], commits: FilVue['commits'], sessions: readonly SessionVue[], t: TextesActivite = TEXTES.fr.archiviste.activite, ts: Textes['sessions'] = TEXTES.fr.sessions): Activite {
	const lignes: LigneActivite[] = [
		...servis.map((e) => ({
			cle: `servi|${e.session}|${e.horodatageMs}|${e.ids.join(',')}`,
			ms: e.horodatageMs,
			titre: nomSession(e.session, sessions, t),
			detail: detailServi(e, t, ts),
		})),
		...commits.map((c) => ({ cle: `commit|${c.hash}`, ms: c.dateMs, titre: nomSession(c.session, sessions, t), detail: messageCourt(c.message) })),
	];
	return { lignes: lignes.sort((a, b) => b.ms - a.ms) };
}

/** « Activité (N) », titre repliable du tiroir : N compté avant la coupure de l'affichage. */
export const libelleActivite = (a: Activite, t: TextesActivite = TEXTES.fr.archiviste.activite): string => t.libelle(a.lignes.length);

/**
 * Activité de l'archiviste : heure, puis session et ce qui a été fait (le conteneur le fait défiler). Montrée par tranches
 * de `ACTIVITE_MAX` : la suivante paraît quand le bas de la liste devient visible (défilement), ou par « N de plus »
 * (clavier, ou sans IntersectionObserver). Jamais tout d'un coup : un jour chargé compte des centaines de changements.
 * `tronque` : le journal du jour a atteint sa limite, les plus anciens manquent (dit en bas de la liste).
 */
export function ActiviteArchiviste(p: { activite: Activite; libelle: string; tronque?: boolean }): ReactNode {
	const textes = useTextes();
	const t = textes.archiviste.activite;
	const [nombre, setNombre] = useState(ACTIVITE_MAX);
	const affichees = p.activite.lignes.slice(0, nombre);
	const reste = p.activite.lignes.length - affichees.length;
	const suite = () => setNombre((n) => n + ACTIVITE_MAX);
	const bas = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const cible = bas.current;
		if (cible === null || reste <= 0 || typeof IntersectionObserver === 'undefined') return;
		const observateur = new IntersectionObserver((entrees) => {
			if (entrees.some((e) => e.isIntersecting)) suite();
		});
		observateur.observe(cible);
		return () => observateur.disconnect();
	}, [reste]);
	return (
		<div className={s.activite}>
			<ul className={s.liste} aria-label={p.libelle}>
				{affichees.map((l) => (
					<li key={l.cle} className={s.ligne}>
						<span className={s.heure}>{textes.commun.formats.heure(l.ms)}</span>
						<span className={s.quoi}>
							<span>{l.titre}</span>
							<em>{l.detail}</em>
						</span>
					</li>
				))}
			</ul>
			{p.activite.lignes.length === 0 && <p className={s.vide}>{t.rienEncore}</p>}
			{reste > 0 && (
				<div ref={bas} className={s.suite}>
					<Bouton petit onClick={suite}>
						{t.dePlus(Math.min(reste, ACTIVITE_MAX))}
					</Bouton>
					<span>{t.restants(reste)}</span>
				</div>
			)}
			{p.tronque === true && reste <= 0 && <p className={s.vide}>{t.tronque}</p>}
		</div>
	);
}
