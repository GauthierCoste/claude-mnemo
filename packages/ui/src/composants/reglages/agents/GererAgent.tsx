/**
 * Bas du créateur d'agent, replié : « Gérer l'agent ». Sa fiche dans la mémoire, ce que reçoit une session (aperçu lu à
 * l'ouverture), dupliquer (sous un autre nom), supprimer (avec confirmation dans la page ; indisponible, avec la raison, pour
 * un agent fourni par Mnemo).
 */
import { DOSSIERS_FIXES } from '@mnemo/commun';
import { ROUTES } from '@mnemo/contrat';
import type { ProfilDetailVue, ReponseEcritureProfil } from '@mnemo/contrat';
import { useId, useState, type ReactNode } from 'react';
import { ErreurApi } from '../../../client/api.ts';
import { useClient } from '../../../client/contexte.tsx';
import { avecId } from '../../../client/hooks.ts';
import { Bouton } from '../../commun/Bouton.tsx';
import f from '../champs/Saisie.module.css';
import s from './Agents.module.css';
import { ApercuAgent } from './ApercuAgent.tsx';

export function GererAgent(p: { detail: ProfilDetailVue; modifie: boolean; surDuplique(nom: string): void; surSupprime(): void }): ReactNode {
	const { api } = useClient();
	const d = p.detail;
	const id = useId();
	const [apercu, setApercu] = useState(false);
	const [copie, setCopie] = useState<string | null>(null);
	const [confirmer, setConfirmer] = useState(false);
	const [envoi, setEnvoi] = useState(false);
	const [erreur, setErreur] = useState<string | null>(null);

	const dupliquer = async () => {
		if (copie === null || copie.trim() === '') return;
		setEnvoi(true);
		setErreur(null);
		try {
			const nom = copie.trim();
			await api.envoyer<ReponseEcritureProfil>(avecId(ROUTES.profilDupliquer, d.nom), { nom });
			setCopie(null);
			p.surDuplique(nom);
		} catch (e) {
			setErreur(e instanceof ErreurApi ? e.message : 'Duplication impossible.');
		} finally {
			setEnvoi(false);
		}
	};

	const supprimer = async () => {
		setEnvoi(true);
		setErreur(null);
		try {
			await api.supprimer<ReponseEcritureProfil>(avecId(ROUTES.profil, d.nom));
			p.surSupprime();
		} catch (e) {
			setErreur(e instanceof ErreurApi ? e.message : 'Suppression impossible.');
			setConfirmer(false);
		} finally {
			setEnvoi(false);
		}
	};

	return (
		<details className={s.gerer}>
			<summary className={s.titreGerer}>Gérer l’agent</summary>
			<div className={s.contenuGerer}>
				<p className={s.effet}>
					Fiche <code>{DOSSIERS_FIXES.profils}/{d.nom}/{d.nom}.md</code>
					{d.empreinte === null && ' (pas encore écrite : valeurs par défaut)'}
				</p>
				<details className={s.sousGerer} onToggle={(e) => setApercu(e.currentTarget.open)}>
					<summary>Ce que reçoit une session</summary>
					{apercu && <ApercuAgent nom={d.nom} modifie={p.modifie} />}
				</details>
				{copie === null ? (
					<div className={f.actions}>
						<Bouton petit disabled={envoi} onClick={() => setCopie(`${d.nom}-copie`)}>
							Dupliquer…
						</Bouton>
						{!confirmer && (
							<Bouton petit disabled={envoi} indisponible={!d.supprimable && { raison: `${id}-fixe` }} onClick={() => setConfirmer(true)}>
								Supprimer…
							</Bouton>
						)}
						{!d.supprimable && (
							<span id={`${id}-fixe`} className={s.effet}>
								Fourni par Mnemo : il ne se supprime pas.
							</span>
						)}
					</div>
				) : (
					<div className={f.actions}>
						<label className={f.libelle} htmlFor={`${id}-copie`}>
							Nom de la copie
						</label>
						<input id={`${id}-copie`} className={f.champTexte} spellCheck={false} value={copie} onChange={(e) => setCopie(e.target.value)} />
						<Bouton petit genre="primaire" disabled={envoi || copie.trim() === ''} onClick={() => void dupliquer()}>
							Dupliquer
						</Bouton>
						<Bouton petit disabled={envoi} onClick={() => setCopie(null)}>
							Annuler
						</Bouton>
					</div>
				)}
				{confirmer && (
					<div className={f.avis} role="alert">
						<p>Supprimer l’agent « {d.nom} » et ses skills propres ? Un commit le retire ; ses sessions se reprendront avec les valeurs par défaut de l’agent travail.</p>
						<div className={f.actions}>
							<Bouton petit disabled={envoi} onClick={() => void supprimer()}>
								Supprimer
							</Bouton>
							<Bouton petit genre="primaire" disabled={envoi} onClick={() => setConfirmer(false)}>
								Garder
							</Bouton>
						</div>
					</div>
				)}
				{erreur !== null && (
					<p className={f.erreur} role="alert">
						{erreur}
					</p>
				)}
			</div>
		</details>
	);
}
