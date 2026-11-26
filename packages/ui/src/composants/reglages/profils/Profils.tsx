/**
 * Onglet Profils de la vue Réglages : la liste des profils à gauche, l'éditeur du profil choisi à droite (avec l'aperçu de
 * ce que reçoit une session). Changer de profil, ou en créer un, avec des modifications non enregistrées est retenu dans la
 * page. Pendant la saisie du nom d'un nouveau profil, aucun éditeur n'est ouvert : les réglages faits à droite iraient au
 * profil d'avant, pas au nouveau.
 */
import { ROUTES } from '@mnemo/contrat';
import type { ProfilEditableVue, ReponseEcritureProfil } from '@mnemo/contrat';
import { DOSSIERS_FIXES, NOMS_MOTEURS, PROFIL_TRAVAIL } from '@mnemo/commun';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ErreurApi } from '../../../client/api.ts';
import { useClient } from '../../../client/contexte.tsx';
import { avecId, useProfil, useProfils } from '../../../client/hooks.ts';
import { Bouton } from '../../commun/Bouton.tsx';
import { EditeurProfil } from './EditeurProfil.tsx';
import { ListeProfils } from './ListeProfils.tsx';
import s from './Profils.module.css';

/** Valeurs d'un nouveau profil : celles par défaut du profil `travail` (consigne par défaut), avec un autre avatar. */
const NOUVEAU_PROFIL: ProfilEditableVue = {
	avatar: { forme: 'renard', couleur: 'bleu' },
	consigne: null,
	lancement: 'projet',
	hooks: ['debut', 'message', 'outil', 'apres_outil', 'arret', 'fin'],
	skillsMemoire: 'tous',
	plugins: [],
	moteur: 'claude-code',
	modele: '',
};

/** Où aller une fois les modifications en cours abandonnées : un autre profil, ou la création d'un profil. */
type Demande = { vers: 'profil'; nom: string } | { vers: 'nouveau' };

export function Profils(p: { surModifie(modifie: boolean): void }): ReactNode {
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
		if (modifie.current) setDemande({ vers: 'profil', nom });
		else ouvrir(nom);
	};
	const demanderNouveau = () => {
		if (modifie.current) setDemande({ vers: 'nouveau' });
		else nouveau();
	};

	const creer = async (nom: string): Promise<string | null> => {
		if (profils.donnees?.profils.some((x) => x.nom === nom)) return `Le profil « ${nom} » existe déjà.`;
		try {
			await api.remplacer<ReponseEcritureProfil>(avecId(ROUTES.profil, nom), { editable: NOUVEAU_PROFIL, empreinte: null });
			profils.recharger();
			ouvrir(nom);
			return null;
		} catch (e) {
			return e instanceof ErreurApi ? e.message : 'Création impossible.';
		}
	};

	if (profils.donnees === undefined) {
		return <p className={s.discret}>{profils.erreur ?? 'Chargement des profils…'}</p>;
	}
	const ignores = profils.donnees.ignores;
	return (
		<div className={s.page}>
			<ListeProfils
				profils={profils.donnees.profils}
				choisi={creation ? null : choisi}
				creation={creation}
				surChoix={choisir}
				surOuvrirNouveau={demanderNouveau}
				surAnnulerNouveau={() => setCreation(false)}
				surNouveau={creer}
			/>
			<div className={s.droite}>
				{ignores.length > 0 && (
					<ul className={s.avertissements} aria-label="Dossiers de profils ignorés">
						{ignores.map((x) => (
							<li key={x.nom}>
								{DOSSIERS_FIXES.profils}/{x.nom}/ ignoré : {x.motif}
							</li>
						))}
					</ul>
				)}
				{demande !== null && (
					<div className={s.avis} role="alert">
						<p>Modifications du profil « {choisi} » non enregistrées : les abandonner ?</p>
						<div className={s.actions}>
							<Bouton onClick={() => (demande.vers === 'nouveau' ? nouveau() : ouvrir(demande.nom))}>Abandonner</Bouton>
							<Bouton genre="primaire" onClick={() => setDemande(null)}>
								Rester
							</Bouton>
						</div>
					</div>
				)}
				{creation ? (
					<p className={s.discret}>Nouveau profil : choisis son nom à gauche, puis Créer. Il tournera sur {NOMS_MOTEURS[NOUVEAU_PROFIL.moteur]} ; son avatar, son moteur et le reste se règlent ici une fois le profil créé.</p>
				) : detail.donnees === undefined || detail.donnees.nom !== choisi ? (
					<p className={s.discret}>{detail.erreur ?? 'Chargement du profil…'}</p>
				) : (
					<EditeurProfil
						key={choisi}
						detail={detail.donnees}
						recharger={() => {
							detail.recharger();
							profils.recharger();
						}}
						surModifie={surModifie}
						surDuplique={(nom) => {
							profils.recharger();
							ouvrir(nom);
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
