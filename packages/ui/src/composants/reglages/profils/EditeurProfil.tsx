/**
 * Éditeur d'un profil (Réglages › Profils) : avatar, moteur et modèle, consigne (celle par défaut ou personnalisée), lieu de
 * lancement, hooks de Mnemo, skills de la mémoire, plugins Claude Code (avec ce moteur seulement) ; enregistrement explicite,
 * validé par le service. Une modification
 * faite ailleurs entre-temps est signalée (empreinte) : l'enregistrement est alors refusé jusqu'au rechargement.
 * Dupliquer et supprimer se font ici ; la suppression demande une confirmation dans la page.
 */
import { DOSSIERS_FIXES, estModele, PROFIL_ARCHIVISTE, PROFIL_TRAVAIL } from '@mnemo/commun';
import { ROUTES } from '@mnemo/contrat';
import type { IdMoteur } from '@mnemo/commun';
import type { EvenementHookVue, ProfilDetailVue, ProfilEditableVue, ReponseEcritureProfil } from '@mnemo/contrat';
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ErreurApi } from '../../../client/api.ts';
import { useClient } from '../../../client/contexte.tsx';
import { avecId } from '../../../client/hooks.ts';
import { useNavigation } from '../../../navigation.tsx';
import { AvatarProfil, JETONS_COULEUR } from '../../commun/AvatarProfil.tsx';
import { Bouton } from '../../commun/Bouton.tsx';
import { ApercuProfil } from './ApercuProfil.tsx';
import { ChoixAvatar } from './ChoixAvatar.tsx';
import { ChoixMoteur } from './ChoixMoteur.tsx';
import s from './Profils.module.css';

const HOOKS: { cle: EvenementHookVue; libelle: string; detail: string }[] = [
	{ cle: 'debut', libelle: 'Début', detail: 'note la session au démarrage' },
	{ cle: 'message', libelle: 'Message', detail: 'injecte les consignes et la fiche de position, propose des pistes à chaque message' },
	{ cle: 'outil', libelle: 'Outil', detail: 'refuse une action contraire à une consigne vérifiée' },
	{ cle: 'apres_outil', libelle: 'Après outil', detail: 'note les fiches lues ou écrites (rien n’est injecté)' },
	{ cle: 'arret', libelle: 'Arrêt', detail: 'tient l’état de la session (attend, à relire)' },
	{ cle: 'fin', libelle: 'Fin', detail: 'termine la session ; épisode minimal sans bilan' },
];

/** Rôle du profil, dit sous son nom. */
function roleDe(nom: string): string {
	if (nom === PROFIL_ARCHIVISTE) return 'Range et entretient la mémoire.';
	if (nom === PROFIL_TRAVAIL) return 'Profil par défaut.';
	return '';
}

const egaux = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Coche ou décoche `valeur` dans `liste`, dans l'ordre de `ordre`. */
function basculer<T>(liste: readonly T[], valeur: T, coche: boolean, ordre: readonly T[]): T[] {
	const ensemble = new Set(liste);
	if (coche) ensemble.add(valeur);
	else ensemble.delete(valeur);
	return [...ordre.filter((x) => ensemble.has(x)), ...[...ensemble].filter((x) => !ordre.includes(x))];
}

export function EditeurProfil(p: {
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
	const [copie, setCopie] = useState<string | null>(null);
	const [confirmerSuppression, setConfirmerSuppression] = useState(false);
	const modifie = !egaux(brouillon, base.editable);
	// un modèle refusé (forme) n'est pas envoyé : Enregistrer reste indisponible, avec la raison
	const modeleRefuse = !estModele(brouillon.modele);
	const idModeleRefuse = useId();
	/** Modèle et plugins saisis pour chaque moteur pendant l'édition : un aller-retour de moteur les rend. */
	const [saisiesParMoteur, setSaisiesParMoteur] = useState<Partial<Record<IdMoteur, Pick<ProfilEditableVue, 'modele' | 'plugins'>>>>({});

	// détail relu (écriture ici ou ailleurs) : la saisie repart du disque, sauf modifications en cours (signalées)
	if (base !== d) {
		if (!modifie || d.nom !== base.nom) {
			setBrouillon(structuredClone(d.editable));
			setChangeAilleurs(false);
			setSaisiesParMoteur({});
		} else if (d.empreinte !== base.empreinte) setChangeAilleurs(true);
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
			setStatut(r.commit === null ? 'Rien à enregistrer : le profil était déjà ainsi.' : 'Enregistré.');
			// la base devient la saisie tout de suite (le détail relu arrive ensuite et la confirme)
			setBase({ ...base, editable: structuredClone(brouillon) });
			p.recharger();
			return true;
		} catch (e) {
			if (e instanceof ErreurApi && e.statut === 409) setChangeAilleurs(true);
			setErreur(e instanceof ErreurApi ? e.message : 'Enregistrement impossible.');
			return false;
		} finally {
			setEnvoi(false);
		}
	};
	const enregistrerPuisPartir = async () => {
		if (await enregistrer()) nav.poursuivreSortie();
		else nav.annulerSortie();
	};

	const dupliquer = async () => {
		if (copie === null || copie.trim() === '') return;
		setEnvoi(true);
		setErreur(null);
		try {
			await api.envoyer<ReponseEcritureProfil>(avecId(ROUTES.profilDupliquer, d.nom), { nom: copie.trim() });
			const nom = copie.trim();
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
			setConfirmerSuppression(false);
		} finally {
			setEnvoi(false);
		}
	};

	/**
	 * Autre moteur : un modèle d'un moteur ne vaut pas pour l'autre, et les plugins sont propres à Claude Code. Le modèle et
	 * les plugins saisis pour le moteur quitté sont gardés ; revenir à un moteur rend ceux saisis pour lui, sinon ceux
	 * enregistrés (son moteur enregistré), sinon le modèle par défaut et aucun plugin.
	 */
	const changerMoteur = (moteur: IdMoteur) => {
		const enregistre = base.editable;
		setSaisiesParMoteur((x) => ({ ...x, [brouillon.moteur]: { modele: brouillon.modele, plugins: [...brouillon.plugins] } }));
		const saisie = saisiesParMoteur[moteur] ?? (moteur === enregistre.moteur ? { modele: enregistre.modele, plugins: enregistre.plugins } : { modele: '', plugins: [] });
		changer({ moteur, modele: saisie.modele, plugins: moteur === 'claude-code' ? [...saisie.plugins] : [] });
	};

	const recharger = () => {
		setBrouillon(structuredClone(d.editable));
		setChangeAilleurs(false);
		setSaisiesParMoteur({});
		setErreur(null);
		p.recharger();
	};

	const installes = new Set(d.pluginsInstalles.map((x) => x.id));
	const absents = brouillon.plugins.filter((id) => !installes.has(id));
	const ordrePlugins = d.pluginsInstalles.map((x) => x.id);
	const ordreSkills = d.skillsMemoireDisponibles.map((x) => x.nom);

	return (
		<form
			className={s.editeur}
			aria-label={`Profil ${d.nom}`}
			// titres de section dans la couleur de l'avatar choisie (saisie en cours)
			style={{ '--couleur-profil': JETONS_COULEUR[brouillon.avatar.couleur] } as CSSProperties}
			onSubmit={(e) => e.preventDefault()}
		>
			<header className={s.enteteEditeur}>
				<AvatarProfil avatar={brouillon.avatar} taille={48} titre={`Avatar du profil ${d.nom}`} />
				<div>
					<h2 className={s.titreProfil}>{d.nom}</h2>
					{roleDe(d.nom) !== '' && <p className={s.role}>{roleDe(d.nom)}</p>}
					<p className={s.discret}>
						Fiche <code>{DOSSIERS_FIXES.profils}/{d.nom}/{d.nom}.md</code>
						{d.empreinte === null && ' (pas encore écrite : valeurs par défaut)'}
					</p>
				</div>
			</header>

			{d.avertissements.length > 0 && (
				<ul className={s.avertissements} aria-label="Avertissements">
					{d.avertissements.map((a) => (
						<li key={a}>{a}</li>
					))}
				</ul>
			)}
			{changeAilleurs && (
				<div className={s.avis} role="alert">
					<p>La fiche du profil a changé ailleurs depuis son ouverture : rechargez-la (vos modifications seront perdues).</p>
					<Bouton petit onClick={recharger}>
						Recharger
					</Bouton>
				</div>
			)}

			<Section titre="Avatar">
				<ChoixAvatar avatar={brouillon.avatar} surChoix={(avatar) => changer({ avatar })} />
			</Section>

			<Section titre="Moteur" explication="L’agent de code qui fait tourner les sessions de ce profil ; une session garde le moteur et le modèle de son lancement.">
				<ChoixMoteur profil={d.nom} moteur={brouillon.moteur} modele={brouillon.modele} surMoteur={changerMoteur} surModele={(modele) => changer({ modele })} />
			</Section>

			<Section titre="Consigne" explication="Ajoutée au prompt système de chaque session.">
				{brouillon.consigne === null ? (
					<>
						<p className={s.discret}>Par défaut (suit les mises à jour de Mnemo).</p>
						<pre className={s.texteBloc}>{d.consigneParDefaut}</pre>
						<div className={s.actions}>
							<Bouton petit onClick={() => changer({ consigne: d.consigneParDefaut })}>
								Personnaliser
							</Bouton>
						</div>
					</>
				) : (
					<>
						<textarea className={s.consigne} aria-label="Consigne personnalisée" spellCheck value={brouillon.consigne} rows={12} onChange={(e) => changer({ consigne: e.target.value })} />
						<div className={s.actions}>
							<Bouton petit onClick={() => changer({ consigne: null })}>
								Rétablir la consigne par défaut
							</Bouton>
						</div>
					</>
				)}
			</Section>

			<Section titre="Lancement">
				<div role="radiogroup" aria-label="Lieu de lancement" className={s.cases}>
					{(
						[
							['projet', 'Dans le dossier du projet choisi'],
							['memoire', 'Dans la mémoire (_mnemo/), le dossier Mnemo ajouté'],
						] as const
					).map(([valeur, libelle]) => (
						<label key={valeur} className={s.case}>
							<input type="radio" name="lancement" checked={brouillon.lancement === valeur} disabled={!d.lancementModifiable} onChange={() => changer({ lancement: valeur })} />
							{libelle}
						</label>
					))}
				</div>
			</Section>

			<Section titre="Hooks de Mnemo" explication="Au moins un.">
				<div className={s.liste2}>
					{HOOKS.map((h) => (
						<label key={h.cle} className={s.case}>
							<input
								type="checkbox"
								checked={brouillon.hooks.includes(h.cle)}
								onChange={(e) => changer({ hooks: basculer(brouillon.hooks, h.cle, e.target.checked, HOOKS.map((x) => x.cle)) })}
							/>
							<span>
								{h.libelle} <span className={s.discret}>— {h.detail}</span>
							</span>
						</label>
					))}
				</div>
			</Section>

			<Section titre="Skills de la mémoire">
				<div role="radiogroup" aria-label="Skills de la mémoire" className={s.cases}>
					<label className={s.case}>
						<input type="radio" name="choix-skills-memoire" checked={brouillon.skillsMemoire === 'tous'} onChange={() => changer({ skillsMemoire: 'tous' })} />
						Toutes, y compris les futures
					</label>
					<label className={s.case}>
						<input
							type="radio"
							name="choix-skills-memoire"
							checked={brouillon.skillsMemoire !== 'tous'}
							onChange={() => changer({ skillsMemoire: brouillon.skillsMemoire === 'tous' ? [...ordreSkills] : brouillon.skillsMemoire })}
						/>
						Seulement celles cochées
					</label>
				</div>
				{d.skillsMemoireDisponibles.length === 0 ? (
					<p className={s.discret}>Aucune skill dans _mnemo/skills/.</p>
				) : (
					<div className={s.liste2}>
						{d.skillsMemoireDisponibles.map((x) => {
							const liste = brouillon.skillsMemoire;
							return (
								<label key={x.nom} className={s.case}>
									<input
										type="checkbox"
										disabled={liste === 'tous'}
										checked={liste === 'tous' || liste.includes(x.nom)}
										onChange={(e) => liste !== 'tous' && changer({ skillsMemoire: basculer(liste, x.nom, e.target.checked, ordreSkills) })}
									/>
									<span>
										{x.nom} {x.description !== '' && <span className={s.discret}>— {x.description}</span>}
									</span>
								</label>
							);
						})}
					</div>
				)}
				{d.skillsDuProfil.length > 0 && (
					<>
						<p className={s.discret}>Propres au profil, toujours actives :</p>
						<ul className={s.elements}>
							{d.skillsDuProfil.map((x) => (
								<li key={x.nom} className={s.element}>
									<span className={s.nomElement}>{x.nom}</span>
									{x.description !== '' && <span className={s.discret}>{x.description}</span>}
								</li>
							))}
						</ul>
					</>
				)}
			</Section>

			{brouillon.moteur === 'claude-code' && (
				<Section
					titre="Plugins Claude Code"
					explication="Cochés : allumés. Les autres : éteints dans la session."
				>
					{d.pluginsInstalles.length === 0 && absents.length === 0 ? (
						<p className={s.discret}>Aucun plugin Claude Code installé.</p>
					) : (
						<div className={s.liste2}>
							{d.pluginsInstalles.map((x) => (
								<label key={x.id} className={s.case}>
									<input type="checkbox" checked={brouillon.plugins.includes(x.id)} onChange={(e) => changer({ plugins: basculer(brouillon.plugins, x.id, e.target.checked, ordrePlugins) })} />
									<span>
										{x.id}{' '}
										<span className={s.discret}>
											— version {x.version}, {x.portee}
											{x.skills.length > 0 && `, skills : ${x.skills.map((k) => k.nom).join(', ')}`}
											{x.hooks && ', a ses propres hooks'}
										</span>
									</span>
								</label>
							))}
							{absents.map((id) => (
								<label key={id} className={s.case}>
									<input type="checkbox" checked onChange={() => changer({ plugins: brouillon.plugins.filter((x) => x !== id) })} />
									<span>
										{id} <span className={s.inactif}>non installé</span>
									</span>
								</label>
							))}
						</div>
					)}
				</Section>
			)}

			<ApercuProfil nom={d.nom} modifie={modifie} />

			<section className={s.section} aria-labelledby="gerer-profil">
				<h3 id="gerer-profil" className={s.titreSection}>
					Gérer
				</h3>
				{copie === null ? (
					<div className={s.actions}>
						<Bouton petit disabled={envoi} onClick={() => setCopie(`${d.nom}-copie`)}>
							Dupliquer…
						</Bouton>
						{d.supprimable && !confirmerSuppression && (
							<Bouton petit disabled={envoi} onClick={() => setConfirmerSuppression(true)}>
								Supprimer…
							</Bouton>
						)}
					</div>
				) : (
					<div className={s.ligne}>
						<label className={s.libelle} htmlFor="nom-copie">
							Nom de la copie
						</label>
						<input id="nom-copie" className={s.champTexte} spellCheck={false} value={copie} onChange={(e) => setCopie(e.target.value)} />
						<Bouton petit genre="primaire" disabled={envoi || copie.trim() === ''} onClick={() => void dupliquer()}>
							Dupliquer
						</Bouton>
						<Bouton petit disabled={envoi} onClick={() => setCopie(null)}>
							Annuler
						</Bouton>
					</div>
				)}
				{confirmerSuppression && (
					<div className={s.avis} role="alert">
						<p>
							Supprimer le profil « {d.nom} » et ses skills propres ? Un commit le retire ; ses sessions se reprendront avec les valeurs par défaut du profil
							travail.
						</p>
						<div className={s.actions}>
							<Bouton petit disabled={envoi} onClick={() => void supprimer()}>
								Supprimer
							</Bouton>
							<Bouton petit genre="primaire" disabled={envoi} onClick={() => setConfirmerSuppression(false)}>
								Garder
							</Bouton>
						</div>
					</div>
				)}
			</section>

			<footer className={s.pied}>
				{nav.sortieRetenue && (
					<div className={s.avis} role="alert">
						<p>Modifications du profil non enregistrées : les enregistrer avant de quitter les Réglages ?</p>
						<div className={s.actions}>
							<Bouton genre="primaire" disabled={envoi} indisponible={modeleRefuse && { raison: idModeleRefuse }} onClick={() => void enregistrerPuisPartir()}>
								Enregistrer
							</Bouton>
							<Bouton disabled={envoi} onClick={nav.poursuivreSortie}>
								Abandonner
							</Bouton>
							<Bouton disabled={envoi} onClick={nav.annulerSortie}>
								Rester
							</Bouton>
						</div>
					</div>
				)}
				{statut !== null && !modifie && (
					<p className={s.statut} role="status">
						{statut}
					</p>
				)}
				{erreur !== null && (
					<p className={s.erreur} role="alert">
						{erreur}
					</p>
				)}
				{modeleRefuse && (
					<p id={idModeleRefuse} className={s.erreur}>
						Enregistrement impossible : le nom du modèle est refusé (section Moteur) ; corrige-le ou reviens au modèle par défaut.
					</p>
				)}
				<div className={s.actions}>
					<Bouton genre="primaire" disabled={!modifie || envoi || changeAilleurs} indisponible={modifie && modeleRefuse && { raison: idModeleRefuse }} onClick={() => void enregistrer()}>
						Enregistrer
					</Bouton>
					<Bouton
						disabled={!modifie || envoi}
						onClick={() => {
							setBrouillon(structuredClone(base.editable));
							setSaisiesParMoteur({});
							setErreur(null);
						}}
					>
						Annuler les modifications
					</Bouton>
				</div>
			</footer>
		</form>
	);
}

function Section(p: { titre: string; explication?: string; children: ReactNode }): ReactNode {
	return (
		<fieldset className={s.section}>
			<legend className={s.titreSection}>{p.titre}</legend>
			{p.explication !== undefined && <p className={s.discret}>{p.explication}</p>}
			{p.children}
		</fieldset>
	);
}
