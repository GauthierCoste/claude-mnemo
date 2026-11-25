/**
 * Panneau Contexte, à droite de la vue Sessions : en-tête (avatar du profil, état, objectif), dossier non rattaché (texte du
 * service : aucune fiche ne couvre le dossier de la session), carte Dossier / Moteur / Démarrée / Durée / Branche / Contexte
 * (fenêtre du moteur), « Injecté dans la session » (fiches injectées ◆, classement vivant du dernier message, pistes et fiches
 * lues ◈ ; clic → Mémoire › Fichiers), puis les actions permises par l'état ; une session que son moteur ne peut pas reprendre
 * (Codex pas encore commencé) a pause, reprise et bilan grisés, avec la raison. Quotas : dits absents pour un moteur qui n'en
 * communique pas (ceux des autres sont dans la barre de titre). Une session qui attend son premier message (GitHub Copilot
 * CLI) le dit.
 */
import { estIdMoteur, MOTEUR_PAR_DEFAUT } from '@mnemo/commun';
import type { EntreeServieVue, InjectionVue, LueVue, SessionVue } from '@mnemo/contrat';
import { useState, type ReactNode } from 'react';
import { useFenetre, useGraphe } from '../../client/hooks.ts';
import { couleurDeBranche, rangsDesFiches } from '../../graphe/branches.ts';
import { moteurEtModele, nomDuMoteur } from '../../moteurs/noms.ts';
import { bilanPermis, dureeSession } from '../../sessions/etats.ts';
import { Bouton } from '../commun/Bouton.tsx';
import { abonnementDuMoteur } from '../Quotas.tsx';
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
	/** Injections à la main et par Mnemo de la session (journal des gestes). */
	injections?: readonly InjectionVue[];
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
	// ni pause, ni reprise, ni bilan : le moteur ne saurait pas reprendre la session (l'abandon reste possible)
	const sansReprise = x.sansReprise ?? null;
	const idRaison = `sans-reprise-${x.id}`;
	// indisponibles avec leur raison (sous les boutons) : ils gardent le focus et l'annoncent au clavier
	const bloque = { indisponible: sansReprise !== null && { raison: idRaison } };
	// un moteur connu sans quotas lisibles : dit en clair (un moteur inconnu de l'interface : rien n'est affirmé)
	const moteur = x.moteur ?? MOTEUR_PAR_DEFAUT;
	const sansQuotas = estIdMoteur(moteur) && abonnementDuMoteur(moteur) === null;
	return (
		<aside className={s.panneau} aria-label="Contexte" style={p.largeur === undefined ? undefined : { width: p.largeur }}>
			<EnteteSession session={x} />
			{x.attentePremierMessage === 'message' && (
				<p role="note" className={s.avis}>
					En attente de ton premier message dans le terminal ; réponds d’abord à la question de confiance de {nomDuMoteur(x.moteur)}. Le bilan reste possible.
				</p>
			)}
			{x.attentePremierMessage === 'confiance' && (
				<p role="note" className={s.avis}>
					Réponds dans le terminal à la question de confiance de {nomDuMoteur(x.moteur)} : il enverra ensuite lui-même le premier message de la session.
				</p>
			)}
			{x.dossierNonRattache !== null && (
				<p role="note" className={s.avis}>
					{x.dossierNonRattache}
				</p>
			)}
			<div className={s.carte}>
				<span>Dossier</span>
				<span>{x.dossier || p.nomRacine}</span>
				<span>Moteur</span>
				<span>{moteurEtModele(x)}</span>
				<span>Démarrée</span>
				<span>{dateHeure(x.creeeMs)}</span>
				<span>Durée</span>
				<span>{dureeSession(x, p.maintenant)}</span>
				<span>Branche</span>
				<span>{x.branche ?? '—'}</span>
				{sansQuotas && (
					<>
						<span>Quotas</span>
						<span>non communiqués par {nomDuMoteur(moteur)}</span>
					</>
				)}
				{fenetre !== null && (
					<>
						<span>Contexte</span>
						<span title={libelleFenetre(fenetre)}>
							{tokensLisibles(fenetre.utilises)} / {tokensLisibles(fenetre.max)} ({Math.round((fenetre.utilises / fenetre.max) * 100)} %)
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
					<Bouton petit disabled={enCours} onClick={() => void agir('pause')} {...bloque}>
						Mettre en pause
					</Bouton>
				)}
				{x.etat === 'en_pause' && (
					<Bouton petit disabled={enCours} onClick={() => void agir('reprise')} {...bloque}>
						Reprendre
					</Bouton>
				)}
				{bilanPossible && (
					<Bouton
						petit
						disabled={enCours || x.bilanDemandeMs !== null}
						onClick={() => void agir('bilan')}
						{...(x.bilanDemandeMs !== null ? { title: 'Bilan demandé' } : bloque)}
					>
						Terminer avec bilan
					</Bouton>
				)}
				{x.etat === 'a_relire' && (
					<Bouton petit genre="primaire" disabled={enCours} onClick={() => void agir('bilan')} {...bloque}>
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
			{sansReprise !== null && (
				<p id={idRaison} role="note" className={s.avis}>
					Pause, reprise et bilan impossibles pour l’instant : {sansReprise}. Abandonner reste possible.
				</p>
			)}
		</aside>
	);
}
