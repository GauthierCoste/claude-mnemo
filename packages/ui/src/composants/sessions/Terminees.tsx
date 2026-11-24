/**
 * Sessions terminées (tiroir de la vue Sessions, ouvert par « N terminées ») : titre, dossier, dates, bilan s'il existe
 * (clic → la fiche dans Mémoire), et « Retirer de l'historique », confirmé : le service oublie la session (son état chez
 * Mnemo et son plugin) ; la transcription de Claude Code, l'épisode et les fiches restent. Ouvert, le focus entre dans le
 * tiroir ; fermé, il revient à l'élément d'avant (s'il était resté dans le tiroir).
 */
import { PROFIL_TRAVAIL } from '@mnemo/commun';
import { ROUTES, type SessionTermineeVue } from '@mnemo/contrat';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ErreurApi } from '../../client/api.ts';
import { useClient } from '../../client/contexte.tsx';
import { avecId } from '../../client/hooks.ts';
import type { Ressource } from '../../client/ressources.ts';
import { useNavigation } from '../../navigation.tsx';
import { Bouton } from '../commun/Bouton.tsx';
import { cx } from '../commun/classes.ts';
import { Tiroir } from '../commun/Tiroir.tsx';
import { useToast } from '../Toast.tsx';
import { dateHeure } from './PanneauContexte.tsx';
import { AvatarProfil } from '../commun/AvatarProfil.tsx';
import { useAvatarsDeProfils } from '../commun/avatar-de-profil.ts';
import s from './Terminees.module.css';

/** `demandee` : la session ouverte depuis une autre vue (`ouvrirSession`) : sa ligne est marquée et reçoit le focus. */
export function Terminees(p: { ouvert: boolean; historique: Ressource<SessionTermineeVue[]>; nomRacine: string; demandee: string | null; surFermer(): void }): ReactNode {
	const { api } = useClient();
	const nav = useNavigation();
	const toast = useToast();
	const avatarDe = useAvatarsDeProfils();
	const [confirmation, setConfirmation] = useState<string | null>(null);
	const [enCours, setEnCours] = useState<string | null>(null);
	const sessions = p.historique.donnees ?? [];
	const contenu = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!p.ouvert) return;
		const actif = document.activeElement;
		const avant = actif instanceof HTMLElement && actif !== document.body ? actif : null;
		const tiroir = contenu.current?.closest('aside');
		(contenu.current?.querySelector<HTMLElement>('button') ?? tiroir?.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
		return () => {
			const maintenant = document.activeElement;
			const dansLeTiroir = maintenant === null || maintenant === document.body || (tiroir?.contains(maintenant) ?? false);
			if (avant?.isConnected && dansLeTiroir) avant.focus({ preventScroll: true });
		};
	}, [p.ouvert]);

	// terminée pendant la visite : absente de l'historique lu à l'ouverture, il est relu une fois ; toujours absente : dit
	const { recharger } = p.historique;
	// `avant` : la liste lue avant la relecture ; le message attend une liste plus récente
	const [relue, setRelue] = useState<{ id: string; avant: SessionTermineeVue[] | undefined } | null>(null);
	const demandeeAbsente = p.demandee !== null && p.historique.donnees !== undefined && !sessions.some((x) => x.id === p.demandee);
	useEffect(() => {
		if (!demandeeAbsente || p.demandee === null || relue?.id === p.demandee) return;
		setRelue({ id: p.demandee, avant: p.historique.donnees });
		recharger();
	}, [demandeeAbsente, relue, p.demandee, p.historique.donnees, recharger]);
	const introuvable = demandeeAbsente && relue?.id === p.demandee && p.historique.donnees !== relue.avant && !p.historique.chargement;
	const demandeePresente = p.ouvert && p.demandee !== null && sessions.some((x) => x.id === p.demandee);
	useEffect(() => {
		if (!demandeePresente) return;
		const ligne = contenu.current?.querySelector<HTMLElement>('[aria-current="true"]');
		ligne?.scrollIntoView?.({ block: 'nearest' });
		ligne?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
	}, [demandeePresente, p.demandee]);

	const retirer = async (id: string) => {
		setConfirmation(null);
		setEnCours(id);
		try {
			await api.supprimer(avecId(ROUTES.session, id));
			toast('Session retirée de l’historique.');
			p.historique.recharger();
		} catch (e) {
			toast(e instanceof ErreurApi ? e.message : 'Retrait impossible.');
		} finally {
			setEnCours(null);
		}
	};
	const ouvrirBilan = (chemin: string) => {
		p.surFermer();
		nav.ouvrirFiche(chemin);
	};

	return (
		<Tiroir ouvert={p.ouvert} titre="Sessions terminées" surFermer={p.surFermer}>
			<div ref={contenu} className={s.contenu}>
				{p.historique.erreur !== null && <p className={s.mu}>{p.historique.erreur}</p>}
				{introuvable && <p className={s.mu}>La session demandée n’est pas dans l’historique.</p>}
				{p.historique.erreur === null && sessions.length === 0 && <p className={s.mu}>{p.historique.donnees === undefined ? 'Chargement…' : 'Aucune session terminée.'}</p>}
				<ul className={s.liste}>
					{sessions.map((x) => (
						<li key={x.id} className={cx(s.session, x.id === p.demandee && s.demandee)} aria-current={x.id === p.demandee ? 'true' : undefined}>
							<b className={s.titre}>
								<AvatarProfil avatar={avatarDe(x.profil)} taille={16} titre={`Profil ${x.profil}`} /> {x.objectif ?? 'Sans objectif'}
							</b>
							<span className={s.mu}>
								{x.dossier || p.nomRacine}
								{x.profil !== PROFIL_TRAVAIL ? `, profil ${x.profil}` : ''}
							</span>
							<span className={s.dates}>
								{dateHeure(x.creeeMs)} → {dateHeure(x.majMs)}
							</span>
							{x.episode ? (
								<button type="button" className={s.bilan} title={x.episode.chemin} onClick={() => ouvrirBilan(x.episode!.chemin)}>
									{x.episode.minimal ? 'Épisode minimal' : 'Bilan'} : {x.episode.titre}
								</button>
							) : (
								<span className={s.mu}>Sans bilan</span>
							)}
							<span className={s.actions}>
								{confirmation === x.id ? (
									<>
										<Bouton petit className={s.danger} disabled={enCours !== null} onClick={() => void retirer(x.id)}>
											Confirmer le retrait
										</Bouton>
										<Bouton petit onClick={() => setConfirmation(null)}>
											Annuler
										</Bouton>
									</>
								) : (
									<Bouton
										petit
										disabled={enCours !== null}
										title="Oublie la session dans Mnemo ; la transcription de Claude Code et la mémoire restent."
										onClick={() => setConfirmation(x.id)}
									>
										Retirer de l’historique
									</Bouton>
								)}
							</span>
						</li>
					))}
				</ul>
			</div>
		</Tiroir>
	);
}
