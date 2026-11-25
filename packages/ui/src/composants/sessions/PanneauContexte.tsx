/**
 * Panneau Contexte, à droite de la vue Sessions : en-tête (avatar du profil, état, objectif), dossier non rattaché (texte du
 * service : aucune fiche ne couvre le dossier de la session), carte Dossier / Démarrée / Durée / Branche / Contexte (fenêtre de
 * Claude Code), « Injecté dans la session » (fiches injectées ◆, cartes proposées ◇, fiches lues ◈ ; clic → Mémoire › Fichiers),
 * puis les actions permises par l'état.
 */
import type { EntreeServieVue, LueVue, SessionVue } from '@mnemo/contrat';
import { useState, type ReactNode } from 'react';
import { useFenetre, useGraphe } from '../../client/hooks.ts';
import { couleurDeBranche, rangsDesFiches } from '../../graphe/branches.ts';
import { bilanPermis, dureeSession } from '../../sessions/etats.ts';
import { Bouton } from '../commun/Bouton.tsx';
import { useActionSession, type ActionSession } from './actions-session.ts';
import { ClassementEnDirect } from './ClassementEnDirect.tsx';
import { EnteteSession } from './EnteteSession.tsx';
import { libelleFenetre, tokensLisibles } from './JaugeContexte.tsx';
import s from './PanneauContexte.module.css';

const deux = (n: number) => String(n).padStart(2, '0');

/** « 21.11.2026 09:12 », heure locale. */
export function dateHeure(ms: number): string {
	const d = new Date(ms);
	return `${deux(d.getDate())}.${deux(d.getMonth() + 1)}.${d.getFullYear()} ${deux(d.getHours())}:${deux(d.getMinutes())}`;
}

function useCouleurBranche(): (chemin: string) => string {
	const graphe = useGraphe();
	const rangs = rangsDesFiches((graphe.donnees?.fiches ?? []).map((f) => f.chemin));
	return (chemin) => couleurDeBranche(rangs, chemin);
}

export function PanneauContexte(p: {
	/** Largeur réglée par le séparateur (px) ; absente : celle de la feuille de style. */
	largeur?: number;
	session: SessionVue;
	nomRacine: string;
	maintenant: number;
	/** Fiches injectées, sans doublon, plus récentes d'abord. */
	fiches: readonly string[];
	/** Ce que `servir` a calculé pour la session : fiches injectées, cartes proposées, motif d'un message muet. */
	entrees: readonly EntreeServieVue[];
	/** Fiches lues par la session, avec l'heure de leur dernière lecture. */
	lues?: readonly LueVue[];
	surOuvrirFiche(chemin: string): void;
}): ReactNode {
	const couleur = useCouleurBranche();
	const fenetre = useFenetre(p.session.id);
	const [confirmation, setConfirmation] = useState<string | null>(null);
	const action = useActionSession();
	const enCours = action.enCours;
	const x = p.session;
	const confirmer = confirmation === x.id;

	const agir = (a: ActionSession) => {
		setConfirmation(null);
		return action.agir(x.id, a);
	};

	const actif = x.etat === 'travaille' || x.etat === 'attend';
	const bilanPossible = bilanPermis(x.etat);
	return (
		<aside className={s.panneau} aria-label="Contexte" style={p.largeur === undefined ? undefined : { width: p.largeur }}>
			<EnteteSession session={x} />
			{x.dossierNonRattache !== null && (
				<p role="note" className={s.avis}>
					{x.dossierNonRattache}
				</p>
			)}
			<div className={s.carte}>
				<span>Dossier</span>
				<span>{x.dossier || p.nomRacine}</span>
				<span>Démarrée</span>
				<span>{dateHeure(x.creeeMs)}</span>
				<span>Durée</span>
				<span>{dureeSession(x, p.maintenant)}</span>
				<span>Branche</span>
				<span>{x.branche ?? '—'}</span>
				{fenetre !== null && (
					<>
						<span>Contexte</span>
						<span title={libelleFenetre(fenetre)}>
							{tokensLisibles(fenetre.utilises)} / {tokensLisibles(fenetre.max)} ({Math.round((fenetre.utilises / fenetre.max) * 100)} %)
						</span>
					</>
				)}
			</div>
			<ClassementEnDirect key={x.id} session={x.id} entrees={p.entrees} modifiable={x.etat !== 'terminee'} niveauModeles={x.niveauModeles} servies={p.fiches} lues={p.lues ?? []} surOuvrirFiche={p.surOuvrirFiche} couleur={couleur} />
			<div className={s.actions}>
				{actif && (
					<Bouton petit disabled={enCours} onClick={() => void agir('pause')}>
						Mettre en pause
					</Bouton>
				)}
				{x.etat === 'en_pause' && (
					<Bouton petit disabled={enCours} onClick={() => void agir('reprise')}>
						Reprendre
					</Bouton>
				)}
				{bilanPossible && (
					<Bouton petit disabled={enCours || x.bilanDemandeMs !== null} onClick={() => void agir('bilan')} title={x.bilanDemandeMs !== null ? 'Bilan demandé' : undefined}>
						Terminer avec bilan
					</Bouton>
				)}
				{x.etat === 'a_relire' && (
					<Bouton petit genre="primaire" disabled={enCours} onClick={() => void agir('bilan')}>
						Faire le bilan
					</Bouton>
				)}
				{x.etat !== 'terminee' &&
					(confirmer ? (
						<span className={s.confirmation}>
							<Bouton petit disabled={enCours} className={s.danger} onClick={() => void agir('abandon')}>
								Confirmer l’abandon
							</Bouton>
							<Bouton petit onClick={() => setConfirmation(null)}>
								Annuler
							</Bouton>
						</span>
					) : (
						<Bouton petit disabled={enCours} onClick={() => setConfirmation(x.id)}>
							Abandonner
						</Bouton>
					))}
			</div>
		</aside>
	);
}
