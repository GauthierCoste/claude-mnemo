/**
 * Panneau Contexte, à droite de la vue Sessions : en-tête (avatar du profil, état, objectif), dossier non rattaché (texte du
 * service : aucune fiche ne couvre le dossier de la session), carte Dossier / Moteur / Démarrée / Durée / Branche / Contexte
 * (fenêtre du moteur), « Injecté dans la session » (fiches injectées ◆, classement vivant du dernier message, pistes et fiches
 * lues ◈ ; clic → Mémoire › Fichiers), puis les actions permises par l'état ; une session que son moteur ne peut pas reprendre
 * (Codex pas encore commencé) a pause, reprise et bilan grisés, avec la raison. Quotas : dits absents pour un moteur qui n'en
 * communique pas (ceux des autres sont dans la barre de titre).
 */
import { estIdMoteur, MOTEUR_PAR_DEFAUT } from '@mnemo/commun';
import type { EntreeServieVue, InjectionVue, LueVue, SessionVue } from '@mnemo/contrat';
import { useState, type ReactNode } from 'react';
import { useFenetre, useGraphe } from '../../client/hooks.ts';
import { couleurDeBranche, rangsDesFiches } from '../../graphe/branches.ts';
import { moteurEtModele, nomDuMoteur } from '../../moteurs/noms.ts';
import { bilanPermis, dureeSession } from '../../sessions/etats.ts';
import { Bouton } from '../commun/Bouton.tsx';
import { useTextes } from '../../langue/langue.tsx';
import { abonnementDuMoteur } from '../Quotas.tsx';
import { useActionSession, type ActionSession } from './actions-session.ts';
import { ClassementEnDirect } from './ClassementEnDirect.tsx';
import { EnteteSession } from './EnteteSession.tsx';
import { libelleFenetre, tokensLisibles } from './JaugeContexte.tsx';
import s from './PanneauContexte.module.css';

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
	/** Injections à la main et par Mnemo de la session (journal des gestes). */
	injections?: readonly InjectionVue[];
	surOuvrirFiche(chemin: string): void;
}): ReactNode {
	const textes = useTextes();
	const t = textes.sessions.panneau;
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
	// ni pause, ni reprise, ni bilan : le moteur ne saurait pas reprendre la session (l'abandon reste possible)
	const sansReprise = x.sansReprise ?? null;
	const idRaison = `sans-reprise-${x.id}`;
	// indisponibles avec leur raison (sous les boutons) : ils gardent le focus et l'annoncent au clavier
	const bloque = { indisponible: sansReprise !== null && { raison: idRaison } };
	// un moteur connu sans quotas lisibles : dit en clair (un moteur inconnu de l'interface : rien n'est affirmé)
	const moteur = x.moteur ?? MOTEUR_PAR_DEFAUT;
	const sansQuotas = estIdMoteur(moteur) && abonnementDuMoteur(moteur) === null;
	return (
		<aside className={s.panneau} aria-label={t.region} style={p.largeur === undefined ? undefined : { width: p.largeur }}>
			<EnteteSession session={x} />
			{x.dossierNonRattache !== null && (
				<p role="note" className={s.avis}>
					{x.dossierNonRattache}
				</p>
			)}
			<div className={s.carte}>
				<span>{t.dossier}</span>
				<span>{x.dossier || p.nomRacine}</span>
				<span>{t.moteur}</span>
				<span>{moteurEtModele(x, textes)}</span>
				<span>{t.demarree}</span>
				<span>{textes.commun.formats.dateHeure(x.creeeMs)}</span>
				<span>{t.duree}</span>
				<span>{dureeSession(x, p.maintenant, textes.sessions)}</span>
				<span>{t.branche}</span>
				<span>{x.branche ?? '—'}</span>
				{sansQuotas && (
					<>
						<span>{t.quotas}</span>
						<span>{t.quotasAbsents(nomDuMoteur(moteur))}</span>
					</>
				)}
				{fenetre !== null && (
					<>
						<span>{t.contexte}</span>
						<span title={libelleFenetre(fenetre, textes.sessions)}>
							{t.fenetre(tokensLisibles(fenetre.utilises, textes.sessions), tokensLisibles(fenetre.max, textes.sessions), Math.round((fenetre.utilises / fenetre.max) * 100))}
						</span>
					</>
				)}
			</div>
			<ClassementEnDirect
				key={x.id}
				session={x.id}
				entrees={p.entrees}
				modifiable={x.etat !== 'terminee'}
				niveauModeles={x.niveauModeles}
				position={x.position}
				servies={p.fiches}
				lues={p.lues ?? []}
				injections={p.injections ?? []}
				coupures={x.injectionCoupee ?? []}
				suggestions={x.suggestionsEcarteeToujours ?? []}
				surOuvrirFiche={p.surOuvrirFiche}
				couleur={couleur}
			/>
			<div className={s.actions}>
				{actif && (
					<Bouton petit disabled={enCours} onClick={() => void agir('pause')} title={t.pauseTitre} {...bloque}>
						{t.pause}
					</Bouton>
				)}
				{x.etat === 'en_pause' && (
					<Bouton petit disabled={enCours} onClick={() => void agir('reprise')} {...bloque}>
						{t.reprendre}
					</Bouton>
				)}
				{bilanPossible && (
					<Bouton
						petit
						disabled={enCours || x.bilanDemandeMs !== null}
						onClick={() => void agir('bilan')}
						{...(x.bilanDemandeMs !== null ? { title: textes.sessions.fermer.bilanDemande } : { title: t.bilanTitre, ...bloque })}
					>
						{t.bilan}
					</Bouton>
				)}
				{x.etat === 'a_relire' && (
					<Bouton petit genre="primaire" disabled={enCours} onClick={() => void agir('bilan')} {...bloque}>
						{textes.sessions.fermer.faireLeBilan}
					</Bouton>
				)}
				{x.etat !== 'terminee' &&
					(confirmer ? (
						<span className={s.confirmation}>
							<Bouton petit disabled={enCours} className={s.danger} onClick={() => void agir('abandon')}>
								{textes.sessions.fermer.confirmerAbandon}
							</Bouton>
							<Bouton petit onClick={() => setConfirmation(null)}>
								{textes.commun.actions.annuler}
							</Bouton>
						</span>
					) : (
						<Bouton petit disabled={enCours} onClick={() => setConfirmation(x.id)} title={t.abandonnerTitre}>
							{textes.sessions.fermer.abandonner}
						</Bouton>
					))}
			</div>
			{sansReprise !== null && (
				<p id={idRaison} role="note" className={s.avis}>
					{t.sansReprise(sansReprise)}
				</p>
			)}
		</aside>
	);
}
