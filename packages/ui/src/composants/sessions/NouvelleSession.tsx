/**
 * Dialogue « Nouvelle session » : profil (ceux du service, `PROFIL_TRAVAIL` d'abord choisi), dossier choisi dans l'arbre
 * (prérempli depuis le panneau ou la ligne, sinon la racine ; un profil lancé dans la mémoire n'en a pas), objectif
 * facultatif → `POST` sessions. Mode dégradé (`manuel`) : la ligne de commande à coller, avec « Copier ». Un profil dont le
 * moteur ne peut pas lancer de session ici (introuvable sans ligne à coller, ou trop ancien : `/api/moteurs`) reste
 * choisissable, mais « Lancer » est indisponible avec la raison.
 */
import { OBJECTIF_MAX, PROFIL_TRAVAIL } from '@mnemo/commun';
import { ROUTES, type ProfilVue, type ReponseLancement, type SessionVue } from '@mnemo/contrat';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ErreurApi } from '../../client/api.ts';
import { useClient } from '../../client/contexte.tsx';
import { useMoteurs, useProfils } from '../../client/hooks.ts';
import { PLIAGE_INITIAL } from '../../dossiers/arbre.ts';
import { ArbreDossiers } from '../commun/ArbreDossiers.tsx';
import { AvatarProfil } from '../commun/AvatarProfil.tsx';
import { Bouton } from '../commun/Bouton.tsx';
import { copierTexte } from '../commun/copier.ts';
import { useToast } from '../Toast.tsx';
import s from './NouvelleSession.module.css';
import { moteurEtModele, moteurParticulier } from '../../moteurs/noms.ts';

/** Où se lance un profil, dit dans le dialogue. */
const LIEUX_DE_LANCEMENT: Record<ProfilVue['lancement'], string> = { projet: 'dans le dossier choisi', memoire: 'dans la mémoire' };

export function NouvelleSession(p: { dossierInitial: string | null; nomRacine: string; surFermer(): void; surLancee(session: SessionVue): void }): ReactNode {
	const { api } = useClient();
	const toast = useToast();
	const dialogue = useRef<HTMLDialogElement>(null);
	const titre = useId();
	const profils = useProfils();
	const [profil, setProfil] = useState<string>(PROFIL_TRAVAIL);
	const choisissables = profils.donnees?.profils.filter((x) => x.lanceur === 'dialogue') ?? null;
	const lancesAPart = profils.donnees?.profils.filter((x) => x.lanceur === 'propre') ?? [];
	const profilChoisi = choisissables?.find((x) => x.nom === profil) ?? null;
	const dansLaMemoire = profilChoisi?.lancement === 'memoire';
	// le moteur du profil ne lancera pas de session ici, et n'a pas de ligne à coller (Claude Code en a une : mode dégradé)
	const moteurs = useMoteurs();
	const moteurDuProfil = profilChoisi === null ? undefined : moteurs.donnees?.moteurs.find((m) => m.id === profilChoisi.moteur);
	const moteurIndisponible = moteurDuProfil !== undefined && moteurDuProfil.indisponible !== null && !moteurDuProfil.manuel ? moteurDuProfil.indisponible : null;
	const idRaison = useId();
	const [dossier, setDossier] = useState(p.dossierInitial ?? '');
	const [pliage, setPliage] = useState(PLIAGE_INITIAL);
	const [objectif, setObjectif] = useState('');
	const [envoi, setEnvoi] = useState(false);
	const [erreur, setErreur] = useState<string | null>(null);
	const [manuel, setManuel] = useState<string | null>(null);

	useEffect(() => {
		const d = dialogue.current;
		if (!d || d.open) return;
		try {
			d.showModal();
		} catch {
			d.setAttribute('open', '');
		}
	}, []);

	const fermer = () => {
		dialogue.current?.close?.();
		p.surFermer();
	};

	const lancer = async (e: FormEvent) => {
		e.preventDefault();
		if (envoi || moteurIndisponible !== null) return;
		setEnvoi(true);
		setErreur(null);
		try {
			const corps = { profil, dossier: dansLaMemoire ? '' : dossier, ...(objectif.trim() ? { objectif: objectif.trim() } : {}) };
			const r = await api.envoyer<ReponseLancement>(ROUTES.sessions, corps);
			// refus : 400 `{ erreur }`, rendu par `ErreurApi`
			if (r.manuel !== undefined) {
				setManuel(r.manuel);
				p.surLancee(r.session);
			} else {
				p.surLancee(r.session);
				toast('Session lancée');
				fermer();
			}
		} catch (x) {
			setErreur(x instanceof ErreurApi ? x.message : 'Lancement impossible.');
		} finally {
			setEnvoi(false);
		}
	};

	const copier = () => {
		if (manuel !== null) copierTexte(manuel, toast, 'Commande copiée');
	};

	return (
		<dialog
			ref={dialogue}
			className={s.dialogue}
			aria-labelledby={titre}
			onCancel={(e) => {
				e.preventDefault();
				fermer();
			}}
		>
			<form className={s.formulaire} onSubmit={(e) => void lancer(e)}>
				<h2 id={titre} className={s.titre}>
					Nouvelle session
				</h2>
				{manuel === null ? (
					<>
						<div className={s.champ}>
							<label className={s.groupe}>
								<span className={s.lbl}>Profil</span>
								{profilChoisi && <AvatarProfil avatar={profilChoisi.avatar} taille={24} titre={`Profil ${profilChoisi.nom}`} />}
								<select value={profil} onChange={(e) => setProfil(e.target.value)}>
									{(choisissables ?? [{ nom: PROFIL_TRAVAIL }]).map((x) => (
										<option key={x.nom} value={x.nom}>
											{x.nom}
										</option>
									))}
								</select>
							</label>
							{profilChoisi && <span className={s.mu}>{profilChoisi.description}</span>}
							{profilChoisi && moteurParticulier(profilChoisi) !== null && <span className={s.mu}>{`Moteur : ${moteurEtModele(profilChoisi)}`}</span>}
							{profils.erreur !== null && <span className={s.erreur}>{`Profils illisibles : ${profils.erreur}`}</span>}
							{lancesAPart.map((x) => (
								<span key={x.nom} className={s.mu}>{`${x.nom} : lancé par son propre chemin, ${LIEUX_DE_LANCEMENT[x.lancement]}.`}</span>
							))}
							{profils.donnees?.avertissements.map((x) => (
								<span key={x.nom} className={s.mu}>{`Profil ${x.nom} : ${x.motif}`}</span>
							))}
							{profils.donnees?.ignores.map((x) => (
								<span key={x.nom} className={s.mu}>{`Profil ignoré, ${x.nom} : ${x.motif}`}</span>
							))}
						</div>
						{dansLaMemoire ? (
							<p className={s.mu}>{`Ce profil se lance ${LIEUX_DE_LANCEMENT.memoire}, quel que soit le dossier.`}</p>
						) : (
							<div className={s.champ} role="group" aria-label="Dossier">
								<ArbreDossiers presentation="cadre" entete={<span className={s.lbl}>{`Dossier : ${dossier || p.nomRacine}`}</span>} choisi={dossier} surChoisir={setDossier} pliage={pliage} surPliage={setPliage} details={() => null} />
							</div>
						)}
						<label className={s.champ}>
							<span className={s.lbl}>Objectif (facultatif)</span>
							<input type="text" maxLength={OBJECTIF_MAX} value={objectif} onChange={(e) => setObjectif(e.target.value)} placeholder="Ce que la session doit faire" />
						</label>
						{moteurIndisponible !== null && (
							<p id={idRaison} className={s.erreur}>
								{`Lancement impossible ici : ${moteurIndisponible}`}
							</p>
						)}
						{erreur && (
							<p role="alert" className={s.erreur}>
								{erreur}
							</p>
						)}
						<div className={s.boutons}>
							<Bouton petit onClick={fermer}>
								Annuler
							</Bouton>
							<Bouton petit genre="primaire" type="submit" disabled={envoi} indisponible={moteurIndisponible !== null && { raison: idRaison }}>
								Lancer
							</Bouton>
						</div>
					</>
				) : (
					<>
						<p className={s.mu}>Les terminaux ne sont pas disponibles dans Mnemo : la session est suivie, lance-la toi-même dans un terminal.</p>
						<code className={s.commande}>{manuel}</code>
						<div className={s.boutons}>
							<Bouton petit onClick={copier}>
								Copier
							</Bouton>
							<Bouton petit genre="primaire" onClick={fermer}>
								Fermer
							</Bouton>
						</div>
					</>
				)}
			</form>
		</dialog>
	);
}
