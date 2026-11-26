/**
 * Dialogue « Nouvelle session » : choisir l'agent comme un personnage, puis où et quoi.
 * - Les agents : les profils lancés par le dialogue (`lanceur: 'dialogue'`), `PROFIL_TRAVAIL` d'abord choisi ; la scène
 *   (`SceneAgents`) et la rangée (`RangeeAgents`, la liste de choix) ; ← → hors d'un champ, flèches, clic sur un voisin ou
 *   une vignette. Les autres profils (lancés à part, avertissements, ignorés) sont dits sous la fiche (`AutresProfils`).
 * - La fiche de l'agent (`FicheAgent`) et l'état de son moteur, lu avec la vérification du poste (`useMoteurs(true)`) sans
 *   bloquer le choix : un moteur qui ne peut pas lancer ici (introuvable sans ligne à coller, trop ancien) ou pas lié à
 *   Mnemo laisse l'agent choisissable, mais « Lancer » est indisponible avec la raison ; « Lier à Mnemo » le débloque.
 * - La mission (`MissionSession`) : dossier replié (prérempli depuis le panneau ou la ligne, sinon la racine ; figé pour un
 *   agent lancé dans la mémoire), objectif facultatif → `POST` sessions ; Entrée lance.
 * - Mode dégradé (`manuel`) : la ligne de commande à coller, avec « Copier ».
 */
import { PROFIL_TRAVAIL } from '@mnemo/commun';
import { ROUTES, type ProfilVue, type ReponseLancement, type SessionVue } from '@mnemo/contrat';
import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ErreurApi } from '../../client/api.ts';
import { useClient } from '../../client/contexte.tsx';
import { useMoteurs, useProfils } from '../../client/hooks.ts';
import { useNavigation } from '../../navigation.tsx';
import { demanderMoteursDansReglages } from '../../reglages/onglet-retenu.ts';
import { etatDuMoteur, resumeDeLaSession } from '../../sessions/agents.ts';
import { JETONS_COULEUR } from '../commun/AvatarProfil.tsx';
import { Bouton } from '../commun/Bouton.tsx';
import { copierTexte } from '../commun/copier.ts';
import { useToast } from '../Toast.tsx';
import { AutresProfils } from './nouvelle/AutresProfils.tsx';
import { FicheAgent } from './nouvelle/FicheAgent.tsx';
import { MissionSession } from './nouvelle/MissionSession.tsx';
import { RangeeAgents } from './nouvelle/RangeeAgents.tsx';
import { SceneAgents } from './nouvelle/SceneAgents.tsx';
import s from './NouvelleSession.module.css';

/** Cible d'une touche qui la garde pour elle : un champ de saisie, ou l'arbre des dossiers. */
const CHAMP = 'input, textarea, select, [contenteditable="true"], [data-arbre]';

export function NouvelleSession(p: { dossierInitial: string | null; nomRacine: string; surFermer(): void; surLancee(session: SessionVue): void }): ReactNode {
	const { api } = useClient();
	const toast = useToast();
	const nav = useNavigation();
	const dialogue = useRef<HTMLDialogElement>(null);
	const formulaire = useRef<HTMLFormElement>(null);
	const titre = useId();
	const idRaison = useId();

	const profils = useProfils();
	const [profil, setProfil] = useState<string>(PROFIL_TRAVAIL);
	const agents: readonly ProfilVue[] = profils.donnees?.profils.filter((x) => x.lanceur === 'dialogue') ?? [];
	const indice = Math.max(0, agents.findIndex((x) => x.nom === profil));
	const agent = agents[indice];
	const choisir = (i: number) => {
		const n = agents.length;
		if (n > 0) setProfil(agents[((i % n) + n) % n]!.nom);
	};
	const dansLaMemoire = agent?.lancement === 'memoire';

	// les moteurs : la lecture légère tout de suite, puis la vérification du poste (quelques secondes), qui la remplace
	const leger = useMoteurs();
	const poste = useMoteurs(true);
	const moteurs = (poste.donnees ?? leger.donnees)?.moteurs;
	const verification = poste.chargement;
	const moteurDe = (a: ProfilVue) => moteurs?.find((m) => m.id === a.moteur);
	const etatDe = (a: ProfilVue) => etatDuMoteur(moteurDe(a), poste.chargement || leger.chargement, poste.erreur ?? leger.erreur);
	const eteints = new Set(agents.filter((a) => etatDe(a).genre === 'bloque').map((a) => a.nom));
	const etat = agent === undefined ? null : etatDe(agent);
	const bloque = etat?.genre === 'bloque' ? etat : null;

	const [dossier, setDossier] = useState(p.dossierInitial ?? '');
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

	// les agents arrivés : le focus sur celui choisi, pour que ← → et Entrée agissent tout de suite
	const charges = agents.length > 0;
	useEffect(() => {
		if (charges) dialogue.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.focus();
	}, [charges]);

	const fermer = () => {
		dialogue.current?.close?.();
		p.surFermer();
	};

	const voirReglages = () => {
		demanderMoteursDansReglages();
		fermer();
		nav.aller('reglages');
	};

	const lancer = async (e: FormEvent) => {
		e.preventDefault();
		if (envoi || bloque !== null || manuel !== null) return;
		setEnvoi(true);
		setErreur(null);
		try {
			const corps = { profil: agent?.nom ?? profil, dossier: dansLaMemoire ? '' : dossier, ...(objectif.trim() ? { objectif: objectif.trim() } : {}) };
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

	// ← → changent d'agent hors d'un champ ; Entrée lance, sauf sur un bouton (il agit) ou dans un champ (il soumet lui-même)
	const clavier = (e: KeyboardEvent<HTMLDialogElement>) => {
		if (manuel !== null || e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return;
		const cible = e.target as HTMLElement;
		if (cible.closest(CHAMP) !== null) return;
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			e.preventDefault();
			choisir(indice + (e.key === 'ArrowRight' ? 1 : -1));
		} else if (e.key === 'Enter' && (cible.closest('button, a') === null || cible.getAttribute('role') === 'option')) {
			e.preventDefault();
			formulaire.current?.requestSubmit();
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
			style={{ '--profil': JETONS_COULEUR[agent?.avatar.couleur ?? 'vert'] } as CSSProperties}
			onKeyDown={clavier}
			onCancel={(e) => {
				e.preventDefault();
				fermer();
			}}
		>
			<form ref={formulaire} className={s.formulaire} onSubmit={(e) => void lancer(e)}>
				<div className={s.entete}>
					<h2 id={titre} className={s.titre}>
						Nouvelle session
					</h2>
					{manuel === null && (
						<span className={s.aide} aria-hidden="true">
							<kbd>←</kbd> <kbd>→</kbd> changer d’agent · <kbd>↵</kbd> lancer · <kbd>Échap</kbd> fermer
						</span>
					)}
				</div>
				{manuel === null ? (
					<>
						<div className={s.scene}>
							{charges ? (
								<SceneAgents agents={agents} choisi={indice} eteints={eteints} surChoisir={choisir} />
							) : (
								<p className={s.attente}>{profils.erreur === null ? 'Lecture des profils…' : 'Aucun agent à proposer.'}</p>
							)}
							<div className={s.colonneFiche}>
								{agent !== undefined && etat !== null && <FicheAgent profil={agent} moteur={moteurDe(agent)} etat={etat} verification={verification} idRaison={idRaison} surVoirReglages={voirReglages} />}
								<AutresProfils profils={profils.donnees} erreur={profils.erreur} />
							</div>
						</div>
						{charges && <RangeeAgents agents={agents} choisi={indice} eteints={eteints} surChoisir={choisir} />}
						<MissionSession dansLaMemoire={dansLaMemoire} dossier={dossier} nomRacine={p.nomRacine} surDossier={setDossier} objectif={objectif} surObjectif={setObjectif} />
						{erreur && (
							<p role="alert" className={s.erreur}>
								{erreur}
							</p>
						)}
						<div className={s.pied}>
							{agent !== undefined && <span className={s.resume}>{resumeDeLaSession(agent, dossier, p.nomRacine)}</span>}
							<div className={s.boutons}>
								<Bouton className={s.bouton} onClick={fermer}>
									Annuler
								</Bouton>
								<Bouton genre="primaire" type="submit" className={`${s.bouton} ${s.lancer}`} disabled={envoi} indisponible={bloque !== null && { raison: idRaison }} title={bloque?.raison}>
									{`Lancer ${agent?.nom ?? profil}`}
								</Bouton>
							</div>
						</div>
					</>
				) : (
					<div className={s.manuel}>
						<p className={s.mu}>Les terminaux ne sont pas disponibles dans Mnemo : la session est suivie, lance-la toi-même dans un terminal.</p>
						<code className={s.commande}>{manuel}</code>
						<div className={s.boutonsManuel}>
							<Bouton className={s.bouton} onClick={copier}>
								Copier
							</Bouton>
							<Bouton genre="primaire" className={s.bouton} onClick={fermer}>
								Fermer
							</Bouton>
						</div>
					</div>
				)}
			</form>
		</dialog>
	);
}
