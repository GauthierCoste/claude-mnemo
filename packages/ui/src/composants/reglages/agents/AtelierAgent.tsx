/**
 * Créateur d'un agent (Réglages › Agents) : la scène à gauche (l'agent sur son podium, sa classe, ses stats, son lieu de
 * départ et le pied Annuler / Enregistrer), les blocs à droite (Apparence, Classe, Équipement, Capacités, Mission), puis
 * « Gérer l'agent » (sa fiche, ce que reçoit une session, dupliquer, supprimer). Tout se règle dans un brouillon, enregistré
 * d'un geste et validé par le service. Une modification faite ailleurs entre-temps est signalée (empreinte) : l'enregistrement
 * est alors refusé jusqu'au rechargement. Les skills s'écrivent, elles, tout de suite (éditeur de skill) : une skill créée
 * dans la mémoire est équipée dans le brouillon ; renommée ou supprimée, le brouillon suit, et l'agent est relu tout de
 * suite (le service a réécrit sa fiche : cette relecture n'est pas un conflit ; Enregistrer attend qu'elle arrive). Après
 * une écriture de skill, le focus revient sur sa case d'inventaire (ou sur l'inventaire, si elle n'existe plus).
 */
import { estModele, PROFIL_ARCHIVISTE, PROFIL_TRAVAIL } from '@mnemo/commun';
import { ROUTES } from '@mnemo/contrat';
import type { IdMoteur } from '@mnemo/commun';
import type { ProfilDetailVue, ProfilEditableVue, ReponseEcritureProfil } from '@mnemo/contrat';
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ErreurApi } from '../../../client/api.ts';
import { useClient } from '../../../client/contexte.tsx';
import { avecId } from '../../../client/hooks.ts';
import { useNavigation } from '../../../navigation.tsx';
import { suivreSkill } from '../../../reglages/equipement.ts';
import { JETONS_COULEUR } from '../../commun/AvatarProfil.tsx';
import { Bouton } from '../../commun/Bouton.tsx';
import s from './Agents.module.css';
import { BlocApparence } from './BlocApparence.tsx';
import { BlocClasse } from './BlocClasse.tsx';
import { BlocEquipement } from './BlocEquipement.tsx';
import { BlocMission } from './BlocMission.tsx';
import { BlocCapacites } from './BlocCapacites.tsx';
import { EditeurSkill, type EcritureSkill } from './EditeurSkill.tsx';
import { GererAgent } from './GererAgent.tsx';
import { Scene } from './Scene.tsx';

/** Rôle de l'agent, dit sous son nom. */
function roleDe(nom: string): string {
	if (nom === PROFIL_ARCHIVISTE) return 'Range et entretient la mémoire.';
	if (nom === PROFIL_TRAVAIL) return 'Agent par défaut.';
	return '';
}

const egaux = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** La skill ouverte dans l'éditeur : `nom` null, une nouvelle skill ; `profil` null, une skill de la mémoire. */
type SkillOuverte = { nom: string | null; profil: string | null };

export function AtelierAgent(p: {
	detail: ProfilDetailVue;
	recharger(): void;
	surModifie(modifie: boolean): void;
	surDuplique(nom: string): void;
	surSupprime(): void;
}): ReactNode {
	const { api } = useClient();
	const d = p.detail;
	const [brouillon, setBrouillon] = useState<ProfilEditableVue>(() => structuredClone(d.editable));
	const [base, setBase] = useState(d);
	const [changeAilleurs, setChangeAilleurs] = useState(false);
	const [envoi, setEnvoi] = useState(false);
	const [erreur, setErreur] = useState<string | null>(null);
	const [statut, setStatut] = useState<string | null>(null);
	const [skill, setSkill] = useState<SkillOuverte | null>(null);
	// une skill de la mémoire renommée ou supprimée d'ici a réécrit la fiche de l'agent : la relecture qui suit n'est pas un conflit
	const [relecture, setRelecture] = useState(false);
	// la case d'inventaire à focaliser après une écriture de skill (null : l'inventaire)
	const [focus, setFocus] = useState<{ nom: string | null } | null>(null);
	const modifie = !egaux(brouillon, base.editable);
	// un modèle refusé (forme) n'est pas envoyé : Enregistrer reste indisponible, avec la raison
	const modeleRefuse = !estModele(brouillon.modele);
	const idRaison = useId();
	/** Modèle et plugins saisis pour chaque moteur pendant l'édition : un aller-retour de moteur les rend. */
	const [saisiesParMoteur, setSaisiesParMoteur] = useState<Partial<Record<IdMoteur, Pick<ProfilEditableVue, 'modele' | 'plugins'>>>>({});

	// détail relu (écriture ici ou ailleurs) : la saisie repart du disque, sauf modifications en cours (signalées)
	if (base !== d) {
		if (!modifie || d.nom !== base.nom) {
			setBrouillon(structuredClone(d.editable));
			setChangeAilleurs(false);
			setSaisiesParMoteur({});
		} else if (d.empreinte !== base.empreinte && !relecture) setChangeAilleurs(true);
		setRelecture(false);
		setBase(d);
	}

	const { surModifie } = p;
	useEffect(() => surModifie(modifie), [surModifie, modifie]);

	const nav = useNavigation();
	const modifieCourant = useRef(modifie);
	modifieCourant.current = modifie;
	const { definirGardeSortie } = nav;
	useEffect(() => {
		definirGardeSortie(() => modifieCourant.current);
		return () => definirGardeSortie(null);
	}, [definirGardeSortie]);

	const changer = (m: Partial<ProfilEditableVue>) => {
		setStatut(null);
		setBrouillon((b) => ({ ...b, ...m }));
	};

	const enregistrer = async (): Promise<boolean> => {
		if (modeleRefuse) return false;
		setEnvoi(true);
		setErreur(null);
		try {
			const r = await api.remplacer<ReponseEcritureProfil>(avecId(ROUTES.profil, d.nom), { editable: brouillon, empreinte: base.empreinte });
			setStatut(r.commit === null ? 'Rien à enregistrer : l’agent était déjà ainsi.' : 'Enregistré.');
			// la base devient la saisie tout de suite (le détail relu arrive ensuite et la confirme)
			setBase({ ...base, editable: structuredClone(brouillon) });
			p.recharger();
			return true;
		} catch (e) {
			if (e instanceof ErreurApi && e.statut === 409) setChangeAilleurs(true);
			else setErreur(e instanceof ErreurApi ? e.message : 'Enregistrement impossible.');
			return false;
		} finally {
			setEnvoi(false);
		}
	};
	const enregistrerPuisPartir = async () => {
		if (await enregistrer()) nav.poursuivreSortie();
		else nav.annulerSortie();
	};

	/**
	 * Autre moteur : un modèle d'un moteur ne vaut pas pour l'autre, et les plugins sont propres à Claude Code. Le modèle et
	 * les plugins saisis pour le moteur quitté sont gardés ; revenir à un moteur rend ceux saisis pour lui, sinon ceux
	 * enregistrés (son moteur enregistré), sinon le modèle par défaut et aucun plugin.
	 */
	const changerMoteur = (moteur: IdMoteur) => {
		if (moteur === brouillon.moteur) return;
		const enregistre = base.editable;
		setSaisiesParMoteur((x) => ({ ...x, [brouillon.moteur]: { modele: brouillon.modele, plugins: [...brouillon.plugins] } }));
		const saisie = saisiesParMoteur[moteur] ?? (moteur === enregistre.moteur ? { modele: enregistre.modele, plugins: enregistre.plugins } : { modele: '', plugins: [] });
		changer({ moteur, modele: saisie.modele, plugins: moteur === 'claude-code' ? [...saisie.plugins] : [] });
	};

	const annuler = () => {
		setBrouillon(structuredClone(base.editable));
		setSaisiesParMoteur({});
		setErreur(null);
		// la base est la dernière lecture de l'agent : plus rien n'entre en conflit avec elle
		if (base === d) setChangeAilleurs(false);
	};
	const recharger = () => {
		setBrouillon(structuredClone(d.editable));
		setChangeAilleurs(false);
		setSaisiesParMoteur({});
		setErreur(null);
		p.recharger();
	};

	/** Une skill écrite par l'éditeur : l'équipement du brouillon la suit (créée dans la mémoire : équipée ici), le focus aussi. */
	const surEcritureSkill = (e: EcritureSkill) => {
		setFocus({ nom: e.genre === 'supprime' ? null : e.nom });
		if (e.profil !== null || e.genre === 'modifie') return;
		if (e.genre === 'cree') {
			if (brouillon.skillsMemoire !== 'tous' && !brouillon.skillsMemoire.includes(e.nom)) changer({ skillsMemoire: [...brouillon.skillsMemoire, e.nom] });
			return;
		}
		const nouveau = e.genre === 'renomme' ? e.nom : null;
		const enregistre = base.editable.skillsMemoire;
		// fiche écrite qui listait la skill : le service l'a réécrite, à relire avant d'enregistrer
		if (base.empreinte !== null && enregistre !== 'tous' && enregistre.includes(e.ancien)) {
			setRelecture(true);
			p.recharger();
		}
		setBrouillon((b) => ({ ...b, skillsMemoire: suivreSkill(b.skillsMemoire, e.ancien, nouveau) }));
	};

	const raisonsBloquantes = changeAilleurs || modeleRefuse || relecture;
	const texteRaison = modeleRefuse
		? 'Enregistrement impossible : le nom du modèle est refusé (Classe) ; à corriger, ou revenir au modèle par défaut.'
		: changeAilleurs
			? 'Enregistrement impossible : l’agent a été modifié ailleurs, à recharger.'
			: relecture
				? 'Relecture de l’agent après l’écriture de la skill…'
				: null;
	return (
		<div className={s.atelier} style={{ '--perso': JETONS_COULEUR[brouillon.avatar.couleur] } as CSSProperties}>
			<div className={s.colonne}>
				<Scene
					nom={d.nom}
					role={roleDe(d.nom)}
					editable={brouillon}
					detail={d}
					surLancement={(lancement) => changer({ lancement })}
				/>
				<footer className={s.pied} aria-label="Enregistrement de l’agent">
					{nav.sortieRetenue && (
						<div className={s.avis} role="alert">
							<p>Modifications de l’agent non enregistrées : les enregistrer avant de quitter les Réglages ?</p>
							<div className={s.actions}>
								<Bouton genre="primaire" petit disabled={envoi} indisponible={raisonsBloquantes && { raison: idRaison }} onClick={() => void enregistrerPuisPartir()}>
									Enregistrer
								</Bouton>
								<Bouton petit disabled={envoi} onClick={nav.poursuivreSortie}>
									Abandonner
								</Bouton>
								<Bouton petit disabled={envoi} onClick={nav.annulerSortie}>
									Rester
								</Bouton>
							</div>
						</div>
					)}
					{changeAilleurs && (
						<div className={s.avis} role="alert">
							<p>Cet agent a été modifié ailleurs depuis son ouverture. Recharger reprend sa version enregistrée ; les modifications faites ici seront perdues.</p>
							<div className={s.actions}>
								<Bouton petit onClick={recharger}>
									Recharger
								</Bouton>
							</div>
						</div>
					)}
					{erreur !== null && (
						<p className={s.erreur} role="alert">
							{erreur}
						</p>
					)}
					{texteRaison !== null && (
						<p id={idRaison} className={modeleRefuse ? s.erreur : changeAilleurs ? s.horsEcran : s.etat}>
							{texteRaison}
						</p>
					)}
					{modifie ? (
						<p className={s.etat}>Modifié, non enregistré</p>
					) : (
						statut !== null && (
							<p className={s.statut} role="status">
								{statut}
							</p>
						)
					)}
					<div className={s.actions}>
						<Bouton disabled={!modifie || envoi} onClick={annuler}>
							Annuler
						</Bouton>
						<Bouton genre="primaire" disabled={!modifie || envoi} indisponible={modifie && raisonsBloquantes && { raison: idRaison }} onClick={() => void enregistrer()}>
							Enregistrer
						</Bouton>
					</div>
				</footer>
			</div>

			<div className={s.creation}>
				{d.avertissements.length > 0 && (
					<ul className={s.avertissements} aria-label="Avertissements">
						{d.avertissements.map((a) => (
							<li key={a}>{a}</li>
						))}
					</ul>
				)}
				<BlocApparence avatar={brouillon.avatar} surChoix={(avatar) => changer({ avatar })} />
				<BlocClasse
					agent={d.nom}
					moteur={brouillon.moteur}
					moteurEnregistre={base.editable.moteur}
					modele={brouillon.modele}
					surMoteur={changerMoteur}
					surModele={(modele) => changer({ modele })}
				/>
				<BlocEquipement
					editable={brouillon}
					detail={d}
					surChange={changer}
					surEditerSkill={(nom, profil) => setSkill({ nom, profil })}
					surNouvelleSkill={() => setSkill({ nom: null, profil: null })}
					focus={focus}
					surFocusFait={() => setFocus(null)}
				/>
				<BlocCapacites hooks={brouillon.hooks} surChange={(hooks) => changer({ hooks })} />
				<BlocMission consigne={brouillon.consigne} consigneParDefaut={d.consigneParDefaut} surChange={(consigne) => changer({ consigne })} />
				<GererAgent detail={d} modifie={modifie} surDuplique={p.surDuplique} surSupprime={p.surSupprime} />
			</div>

			{skill !== null && (
				<EditeurSkill
					nom={skill.nom}
					profil={skill.profil}
					agent={d.nom}
					toutesLesSkills={brouillon.skillsMemoire === 'tous'}
					surEcriture={surEcritureSkill}
					surFermer={() => setSkill(null)}
				/>
			)}
		</div>
	);
}
