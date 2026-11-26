/**
 * Onglet Agents de la vue Réglages : la liste des agents (les profils de session) dans le panneau, le créateur de l'agent
 * choisi à droite. Changer d'agent, ou en créer un, avec des modifications non enregistrées est retenu dans la page. Pendant
 * la saisie du nom d'un nouvel agent, aucun créateur n'est ouvert : les réglages faits à droite iraient à l'agent d'avant.
 */
import { ROUTES } from '@mnemo/contrat';
import type { ProfilEditableVue, ReponseEcritureProfil } from '@mnemo/contrat';
import { DOSSIERS_FIXES, NOMS_MOTEURS, PROFIL_TRAVAIL } from '@mnemo/commun';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ErreurApi } from '../../../client/api.ts';
import { useClient } from '../../../client/contexte.tsx';
import { avecId, useProfil, useProfils } from '../../../client/hooks.ts';
import { Bouton } from '../../commun/Bouton.tsx';
import c from '../Cartes.module.css';
import d from '../Panneau.module.css';
import s from './Agents.module.css';
import { AtelierAgent } from './AtelierAgent.tsx';
import { ListeAgents } from './ListeAgents.tsx';

/** Valeurs d'un nouvel agent : celles par défaut de `travail` (consigne par défaut), avec un autre avatar. */
const NOUVEL_AGENT: ProfilEditableVue = {
	avatar: { forme: 'renard', couleur: 'bleu' },
	consigne: null,
	lancement: 'projet',
	hooks: ['debut', 'message', 'outil', 'apres_outil', 'arret', 'fin'],
	skillsMemoire: 'tous',
	plugins: [],
	moteur: 'claude-code',
	modele: '',
};

/** Où aller une fois les modifications en cours abandonnées : un autre agent, ou la création d'un agent. */
type Demande = { vers: 'agent'; nom: string } | { vers: 'nouveau' };

export function Agents(p: { surModifie(modifie: boolean): void }): ReactNode {
	const { api } = useClient();
	const profils = useProfils();
	const [choisi, setChoisi] = useState<string>(PROFIL_TRAVAIL);
	const [creation, setCreation] = useState(false);
	const [demande, setDemande] = useState<Demande | null>(null);
	const detail = useProfil(choisi);
	const modifie = useRef(false);
	const { surModifie: prevenir } = p;
	const surModifie = useCallback(
		(m: boolean) => {
			modifie.current = m;
			prevenir(m);
		},
		[prevenir],
	);

	const abandonner = () => {
		modifie.current = false;
		prevenir(false);
		setDemande(null);
	};
	const ouvrir = (nom: string) => {
		abandonner();
		setCreation(false);
		setChoisi(nom);
	};
	const nouveau = () => {
		abandonner();
		setCreation(true);
	};
	const choisir = (nom: string) => {
		if (nom === choisi && !creation) return;
		if (modifie.current) setDemande({ vers: 'agent', nom });
		else ouvrir(nom);
	};
	const demanderNouveau = () => {
		if (modifie.current) setDemande({ vers: 'nouveau' });
		else nouveau();
	};

	const creer = async (nom: string): Promise<string | null> => {
		if (profils.donnees?.profils.some((x) => x.nom === nom)) return `L’agent « ${nom} » existe déjà.`;
		try {
			await api.remplacer<ReponseEcritureProfil>(avecId(ROUTES.profil, nom), { editable: NOUVEL_AGENT, empreinte: null });
			profils.recharger();
			ouvrir(nom);
			return null;
		} catch (e) {
			return e instanceof ErreurApi ? e.message : 'Création impossible.';
		}
	};

	if (profils.donnees === undefined) {
		return <p className={c.contenu}>{profils.erreur ?? 'Chargement des agents…'}</p>;
	}
	const ignores = profils.donnees.ignores;
	return (
		<div className={d.page}>
			<ListeAgents
				profils={profils.donnees.profils}
				choisi={creation ? null : choisi}
				creation={creation}
				surChoix={choisir}
				surOuvrirNouveau={demanderNouveau}
				surAnnulerNouveau={() => setCreation(false)}
				surNouveau={creer}
			/>
			<div className={`${c.contenu} ${s.defile}`}>
				{ignores.length > 0 && (
					<ul className={c.avis} aria-label="Dossiers d’agents ignorés">
						{ignores.map((x) => (
							<li key={x.nom}>
								{DOSSIERS_FIXES.profils}/{x.nom}/ ignoré : {x.motif}
							</li>
						))}
					</ul>
				)}
				{demande !== null && (
					<div className={c.avis} role="alert">
						<p>Modifications de l’agent « {choisi} » non enregistrées : les abandonner ?</p>
						<div className={c.actions}>
							<Bouton onClick={() => (demande.vers === 'nouveau' ? nouveau() : ouvrir(demande.nom))}>Abandonner</Bouton>
							<Bouton genre="primaire" onClick={() => setDemande(null)}>
								Rester
							</Bouton>
						</div>
					</div>
				)}
				{creation ? (
					<p className={c.discret}>
						Nouvel agent : son nom se saisit à gauche, puis Créer. Il tournera sur {NOMS_MOTEURS[NOUVEL_AGENT.moteur]} ; son apparence, sa classe et le reste se
						règlent ici une fois l’agent créé.
					</p>
				) : detail.donnees === undefined || detail.donnees.nom !== choisi ? (
					<p className={c.discret}>{detail.erreur ?? 'Chargement de l’agent…'}</p>
				) : (
					<AtelierAgent
						key={choisi}
						detail={detail.donnees}
						recharger={() => {
							detail.recharger();
							profils.recharger();
						}}
						surModifie={surModifie}
						surDuplique={(nom) => {
							profils.recharger();
							// la copie est écrite ; l'ouvrir passe par la garde (brouillon modifié : abandonner ou rester)
							choisir(nom);
						}}
						surSupprime={() => {
							profils.recharger();
							ouvrir(PROFIL_TRAVAIL);
						}}
					/>
				)}
			</div>
		</div>
	);
}
