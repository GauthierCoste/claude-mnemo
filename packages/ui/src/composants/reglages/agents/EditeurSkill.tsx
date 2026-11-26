/**
 * Éditeur d'une skill, en modale (Réglages › Agents) : icône, nom, « Quand l'utiliser » (la description qui la fait charger),
 * contenu Markdown, et qui l'équipe. Chaque geste écrit tout de suite (un commit) : créer, enregistrer (renommer compris),
 * supprimer (le second clic confirme et dit combien d'agents la perdent), revenir à la version d'origine (skill fournie par
 * Mnemo, qui ne se renomme ni ne se supprime : la raison est dite sur l'action grisée). Une nouvelle skill se crée dans la
 * mémoire (partagée par tous les agents, équipée sur l'agent ouvert, dans son brouillon) ou pour cet agent seulement. Une
 * skill changée ailleurs depuis son ouverture (409) : message neutre et « Recharger ».
 */
import { ROUTES } from '@mnemo/contrat';
import type { ReponseEcritureSkill, SkillDetailVue, SkillEditableVue } from '@mnemo/contrat';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ErreurApi } from '../../../client/api.ts';
import { useClient } from '../../../client/contexte.tsx';
import { avecId } from '../../../client/hooks.ts';
import { Bouton } from '../../commun/Bouton.tsx';
import f from '../champs/Saisie.module.css';
import s from './EditeurSkill.module.css';

/** Une écriture faite par l'éditeur, pour que l'agent ouvert suive : `ancien`, le nom d'avant (création : le nom créé). */
export type EcritureSkill = { genre: 'cree' | 'renomme' | 'supprime'; ancien: string; nom: string; profil: string | null };

type Saisie = { icone: string; nom: string; description: string; contenu: string };
const VIDE: Saisie = { icone: '', nom: '', description: '', contenu: '' };
const saisieDe = (d: SkillDetailVue): Saisie => ({ icone: d.icone ?? '', nom: d.nom, description: d.description, contenu: d.contenu });
const corpsDe = (x: Saisie): SkillEditableVue => ({ nom: x.nom.trim(), description: x.description.trim(), icone: x.icone.trim() === '' ? null : x.icone.trim(), contenu: x.contenu });
/** Portée d'une route de skill : `?profil=<nom>` pour une skill d'un agent, rien pour la mémoire. */
const portee = (profil: string | null): string => (profil === null ? '' : `?profil=${encodeURIComponent(profil)}`);
const pluriel = (n: number) => (n > 1 ? 's' : '');

export function EditeurSkill(p: {
	/** null : une nouvelle skill. */
	nom: string | null;
	/** Agent propriétaire d'une skill existante ; null : la mémoire. */
	profil: string | null;
	/** L'agent ouvert dans le créateur. */
	agent: string;
	/** L'agent ouvert retient toutes les skills de la mémoire : une nouvelle y est équipée d'office. */
	toutesLesSkills: boolean;
	surEcriture(e: EcritureSkill): void;
	surFermer(): void;
}): ReactNode {
	const { api } = useClient();
	const id = useId();
	const dialogue = useRef<HTMLDialogElement>(null);
	const nouvelle = p.nom === null;
	const [detail, setDetail] = useState<SkillDetailVue | null>(null);
	const [lecture, setLecture] = useState<string | null>(null);
	const [saisie, setSaisie] = useState<Saisie>({ ...VIDE, icone: '✨' });
	const [pourAgent, setPourAgent] = useState(false);
	const [envoi, setEnvoi] = useState(false);
	const [erreur, setErreur] = useState<string | null>(null);
	const [conflit, setConflit] = useState(false);
	const [confirmer, setConfirmer] = useState(false);
	const profil = nouvelle ? (pourAgent ? p.agent : null) : p.profil;

	useEffect(() => {
		const d = dialogue.current;
		if (!d || d.open) return;
		try {
			d.showModal();
		} catch {
			d.setAttribute('open', '');
		}
	}, []);

	const lire = useCallback(async () => {
		if (p.nom === null) return;
		setLecture(null);
		try {
			const d = await api.lire<SkillDetailVue>(avecId(ROUTES.skill, p.nom), p.profil === null ? undefined : { profil: p.profil });
			setDetail(d);
			setSaisie(saisieDe(d));
			setConflit(false);
			setConfirmer(false);
		} catch (e) {
			setLecture(e instanceof ErreurApi ? e.message : 'Lecture de la skill impossible.');
		}
	}, [api, p.nom, p.profil]);
	useEffect(() => void lire(), [lire]);

	const fermer = () => {
		dialogue.current?.close?.();
		p.surFermer();
	};
	const changer = (m: Partial<Saisie>) => {
		setErreur(null);
		setConfirmer(false);
		setSaisie((x) => ({ ...x, ...m }));
	};

	/** Un geste d'écriture : `false` s'il a échoué (le motif est dit, un conflit proposé au rechargement). */
	const ecrire = async (geste: () => Promise<void>): Promise<void> => {
		setEnvoi(true);
		setErreur(null);
		try {
			await geste();
		} catch (e) {
			if (e instanceof ErreurApi && e.statut === 409) setConflit(true);
			else setErreur(e instanceof ErreurApi ? e.message : 'Écriture impossible.');
			setConfirmer(false);
		} finally {
			setEnvoi(false);
		}
	};

	const enregistrer = () =>
		ecrire(async () => {
			const corps = corpsDe(saisie);
			if (detail === null) {
				const r = await api.envoyer<ReponseEcritureSkill>(`${ROUTES.skills}${portee(profil)}`, corps);
				p.surEcriture({ genre: 'cree', ancien: r.nom, nom: r.nom, profil });
			} else {
				const r = await api.remplacer<ReponseEcritureSkill>(`${avecId(ROUTES.skill, detail.nom)}${portee(detail.profil)}`, { ...corps, empreinte: detail.empreinte });
				if (r.nom !== detail.nom) p.surEcriture({ genre: 'renomme', ancien: detail.nom, nom: r.nom, profil: detail.profil });
			}
			fermer();
		});

	const supprimer = () => {
		if (detail === null) return;
		if (!confirmer) {
			setConfirmer(true);
			return;
		}
		void ecrire(async () => {
			await api.supprimer<ReponseEcritureSkill>(avecId(ROUTES.skill, detail.nom), detail.profil === null ? undefined : { profil: detail.profil });
			p.surEcriture({ genre: 'supprime', ancien: detail.nom, nom: detail.nom, profil: detail.profil });
			fermer();
		});
	};

	const revenir = () =>
		ecrire(async () => {
			if (detail === null) return;
			await api.envoyer<ReponseEcritureSkill>(`${avecId(ROUTES.skillOrigine, detail.nom)}${portee(detail.profil)}`);
			await lire();
		});

	const fixe = detail?.motifFixe ?? null;
	const agents = detail?.agents ?? [];
	const touches = detail?.profil === null ? agents.length : 0;
	const qui = nouvelle
		? pourAgent
			? `Propre à « ${p.agent} » : toujours équipée sur lui, créée tout de suite.`
			: p.toutesLesSkills
				? `Créée tout de suite dans la mémoire ; « ${p.agent} » l’équipe déjà (toutes les skills de la mémoire), les autres agents au choix.`
				: `Créée tout de suite dans la mémoire, et équipée sur « ${p.agent} » : enregistre l’agent pour garder cet équipement. Les autres agents au choix.`
		: detail === null
			? ''
			: detail.profil !== null
				? `Propre à « ${detail.profil} » : toujours équipée sur lui.`
				: agents.length > 0
					? `Équipée par ${agents.join(', ')}.`
					: 'Aucun agent ne l’équipe.';
	const pret = nouvelle || detail !== null;
	const incomplet = saisie.nom.trim() === '' || saisie.description.trim() === '';

	return (
		<dialog
			ref={dialogue}
			className={s.dialogue}
			aria-labelledby={`${id}-titre`}
			onCancel={(e) => {
				e.preventDefault();
				fermer();
			}}
		>
			<form
				className={s.ed}
				onSubmit={(e) => {
					e.preventDefault();
					if (!incomplet && !conflit) void enregistrer();
				}}
			>
				<h2 id={`${id}-titre`} className={s.titre}>
					{nouvelle ? 'Nouvelle skill' : `Skill ${p.nom}`}
				</h2>
				{lecture !== null && (
					<p className={f.erreur} role="alert">
						{lecture}
					</p>
				)}
				{!pret && lecture === null && <p className={f.discret}>Lecture de la skill…</p>}
				{detail !== null && detail.avertissements.length > 0 && (
					<ul className={s.avis} aria-label="Avertissements">
						{detail.avertissements.map((a) => (
							<li key={a}>{a}</li>
						))}
					</ul>
				)}
				{detail?.origine === 'mnemo' && (
					<p className={s.avis}>
						{detail.modifiee
							? 'Skill fournie par Mnemo, modifiée : elle ne suit plus ses mises à jour automatiques. '
							: 'Skill fournie par Mnemo : la modifier arrête ses mises à jour automatiques. '}
						{detail.modifiee && (
							<button type="button" className={s.lien} disabled={envoi} onClick={() => void revenir()}>
								Revenir à la version d’origine
							</button>
						)}
					</p>
				)}
				{nouvelle && (
					<fieldset className={s.portee}>
						<legend className={f.libelle}>Où la créer</legend>
						<label className={s.choix}>
							<input type="radio" name={`${id}-portee`} checked={!pourAgent} onChange={() => setPourAgent(false)} />
							<span>
								Dans la mémoire<small>partagée : chaque agent peut l’équiper</small>
							</span>
						</label>
						<label className={s.choix}>
							<input type="radio" name={`${id}-portee`} checked={pourAgent} onChange={() => setPourAgent(true)} />
							<span>
								Pour {p.agent} seulement<small>dans son dossier, toujours équipée</small>
							</span>
						</label>
					</fieldset>
				)}
				{pret && (
					<>
						<div className={s.deuxC}>
							<label className={s.champ}>
								Icône
								<input className={`${f.champTexte} ${s.icone}`} maxLength={16} value={saisie.icone} onChange={(e) => changer({ icone: e.target.value })} />
							</label>
							<label className={`${s.champ} ${s.large}`}>
								Nom
								<input
									className={f.champTexte}
									placeholder="ex. compte-rendu-client"
									spellCheck={false}
									autoComplete="off"
									readOnly={fixe !== null}
									aria-describedby={fixe !== null ? `${id}-fixe` : `${id}-aide-nom`}
									value={saisie.nom}
									onChange={(e) => changer({ nom: e.target.value })}
								/>
								<small id={`${id}-aide-nom`}>minuscules, chiffres et tirets ; c’est le nom que voit l’agent</small>
							</label>
						</div>
						<label className={s.champ}>
							Quand l’utiliser
							<input
								className={`${f.champTexte} ${s.prose}`}
								placeholder="ex. rédiger le compte rendu d’une réunion client"
								value={saisie.description}
								onChange={(e) => changer({ description: e.target.value })}
							/>
							<small>l’agent charge la skill quand sa tâche correspond à cette phrase</small>
						</label>
						<label className={s.champ}>
							Contenu
							<textarea
								className={`${f.texteLong} ${s.contenu}`}
								rows={10}
								placeholder="Les étapes, les règles, les exemples que l’agent doit suivre (Markdown)."
								value={saisie.contenu}
								onChange={(e) => changer({ contenu: e.target.value })}
							/>
						</label>
						<p className={f.discret}>{qui}</p>
					</>
				)}
				{conflit && (
					<div className={f.avis} role="alert">
						<p>Cette skill a été modifiée ailleurs depuis son ouverture. Recharger reprend sa version enregistrée ; ta saisie ici sera perdue.</p>
						<div className={f.actions}>
							<Bouton petit onClick={() => void lire()}>
								Recharger
							</Bouton>
						</div>
					</div>
				)}
				{erreur !== null && (
					<p className={f.erreur} role="alert">
						{erreur}
					</p>
				)}
				{fixe !== null && (
					<p id={`${id}-fixe`} className={f.discret}>
						{fixe.charAt(0).toUpperCase() + fixe.slice(1)}.
					</p>
				)}
				<div className={s.actionsEd}>
					{detail !== null && (
						<Bouton className={s.supprimer} disabled={envoi} indisponible={fixe !== null && { raison: `${id}-fixe` }} onClick={supprimer}>
							{!confirmer ? 'Supprimer' : touches > 0 ? `Retirer aussi de ${touches} agent${pluriel(touches)} ?` : 'Confirmer la suppression'}
						</Bouton>
					)}
					<span className={s.espace} />
					<Bouton disabled={envoi} onClick={fermer}>
						Annuler
					</Bouton>
					<Bouton type="submit" genre="primaire" disabled={!pret || envoi || conflit || incomplet}>
						{nouvelle ? 'Créer' : 'Enregistrer'}
					</Bouton>
				</div>
			</form>
		</dialog>
	);
}
