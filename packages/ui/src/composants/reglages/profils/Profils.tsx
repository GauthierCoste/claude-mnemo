/**
 * Onglet Profils de la vue Réglages : la liste des profils à gauche, l'éditeur du profil choisi à droite (avec l'aperçu de
 * ce que reçoit une session). Changer de profil avec des modifications non enregistrées est retenu dans la page.
 */
import { ROUTES } from '@mnemo/contrat';
import type { ProfilEditableVue, ReponseEcritureProfil } from '@mnemo/contrat';
import { DOSSIERS_FIXES, PROFIL_TRAVAIL } from '@mnemo/commun';
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

export function Profils(p: { surModifie(modifie: boolean): void }): ReactNode {
	const { api } = useClient();
	const profils = useProfils();
	const [choisi, setChoisi] = useState<string>(PROFIL_TRAVAIL);
	const [demande, setDemande] = useState<string | null>(null);
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

	const ouvrir = (nom: string) => {
		modifie.current = false;
		prevenir(false);
		setDemande(null);
		setChoisi(nom);
	};
	const choisir = (nom: string) => {
		if (nom === choisi) return;
		if (modifie.current) setDemande(nom);
		else ouvrir(nom);
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
			<ListeProfils profils={profils.donnees.profils} choisi={choisi} surChoix={choisir} surNouveau={creer} />
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
							<Bouton onClick={() => ouvrir(demande)}>Abandonner</Bouton>
							<Bouton genre="primaire" onClick={() => setDemande(null)}>
								Rester
							</Bouton>
						</div>
					</div>
				)}
				{detail.donnees === undefined || detail.donnees.nom !== choisi ? (
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
