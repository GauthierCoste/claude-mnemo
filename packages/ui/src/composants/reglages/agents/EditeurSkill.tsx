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
import { useTextes } from '../../../langue/langue.tsx';
import { Bouton } from '../../commun/Bouton.tsx';
import f from '../champs/Saisie.module.css';
import s from './EditeurSkill.module.css';

/**
 * Une écriture faite par l'éditeur, pour que l'agent ouvert suive (équipement, focus) : `ancien`, le nom d'avant (création :
 * le nom créé) ; `nom`, celui d'après.
 */
export type EcritureSkill = { genre: 'cree' | 'modifie' | 'renomme' | 'supprime'; ancien: string; nom: string; profil: string | null };

type Saisie = { icone: string; nom: string; description: string; contenu: string };
const VIDE: Saisie = { icone: '✨', nom: '', description: '', contenu: '' };
const saisieDe = (d: SkillDetailVue): Saisie => ({ icone: d.icone ?? '', nom: d.nom, description: d.description, contenu: d.contenu });
const corpsDe = (x: Saisie): SkillEditableVue => ({ nom: x.nom.trim(), description: x.description.trim(), icone: x.icone.trim() === '' ? null : x.icone.trim(), contenu: x.contenu });
/** Portée d'une route de skill : `?profil=<nom>` pour une skill d'un agent, rien pour la mémoire. */
const portee = (profil: string | null): string => (profil === null ? '' : `?profil=${encodeURIComponent(profil)}`);

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
	const textes = useTextes();
	const t = textes.agents.skill;
	const id = useId();
	const dialogue = useRef<HTMLDialogElement>(null);
	const nouvelle = p.nom === null;
	const [detail, setDetail] = useState<SkillDetailVue | null>(null);
	const [lecture, setLecture] = useState<string | null>(null);
	const [saisie, setSaisie] = useState<Saisie>(VIDE);
	const [abandon, setAbandon] = useState(false);
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
			setLecture(e instanceof ErreurApi ? e.message : t.lectureImpossible);
		}
	}, [api, p.nom, p.profil, t]);
	useEffect(() => void lire(), [lire]);

	const fermer = () => {
		dialogue.current?.close?.();
		p.surFermer();
	};
	/** Saisie différente de la skill lue (ou, pour une nouvelle, d'une saisie vide) : la fermer demande d'abord confirmation. */
	const saisieModifiee = JSON.stringify(saisie) !== JSON.stringify(detail === null ? VIDE : saisieDe(detail));
	const demanderFermeture = () => {
		if (envoi) return;
		if (saisieModifiee) setAbandon(true);
		else fermer();
	};
	const changer = (m: Partial<Saisie>) => {
		setErreur(null);
		setConfirmer(false);
		setAbandon(false);
		setSaisie((x) => ({ ...x, ...m }));
	};

	/** Un geste d'écriture, le temps duquel l'éditeur est occupé ; un échec est dit (motif, ou conflit à recharger). */
	const ecrire = async (geste: () => Promise<void>): Promise<void> => {
		setEnvoi(true);
		setErreur(null);
		try {
			await geste();
		} catch (e) {
			if (e instanceof ErreurApi && e.statut === 409) setConflit(true);
			else setErreur(e instanceof ErreurApi ? e.message : t.ecritureImpossible);
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
				p.surEcriture({ genre: r.nom !== detail.nom ? 'renomme' : 'modifie', ancien: detail.nom, nom: r.nom, profil: detail.profil });
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
			? t.quiPourAgent(p.agent)
			: p.toutesLesSkills
				? t.quiToutes(p.agent)
				: t.quiMemoire(p.agent)
		: detail === null
			? ''
			: detail.profil !== null
				? t.quiPropre(detail.profil)
				: agents.length > 0
					? t.equipeePar(agents.join(', '))
					: t.aucunAgent;
	const pret = nouvelle || detail !== null;
	const incomplet = saisie.nom.trim() === '' || saisie.description.trim() === '';
	// pourquoi Créer / Enregistrer est indisponible (dit sous les actions) ; null : disponible
	const raison = !pret ? t.raisonLecture : conflit ? t.raisonConflit : incomplet ? t.raisonIncomplet : null;

	return (
		<dialog
			ref={dialogue}
			className={s.dialogue}
			aria-labelledby={`${id}-titre`}
			onCancel={(e) => {
				e.preventDefault();
				demanderFermeture();
			}}
		>
			<form
				className={s.ed}
				onSubmit={(e) => {
					e.preventDefault();
					if (raison === null && !envoi) void enregistrer();
				}}
			>
				<h2 id={`${id}-titre`} className={s.titre}>
					{nouvelle || p.nom === null ? t.nouvelle : t.titre(p.nom)}
				</h2>
				{lecture !== null && (
					<p className={f.erreur} role="alert">
						{lecture}
					</p>
				)}
				{!pret && lecture === null && <p className={f.discret}>{t.lecture}</p>}
				{detail !== null && detail.avertissements.length > 0 && (
					<ul className={s.avis} aria-label={t.avertissements}>
						{detail.avertissements.map((a) => (
							<li key={a}>{a}</li>
						))}
					</ul>
				)}
				{detail?.origine === 'mnemo' && (
					<p className={s.avis}>
						{detail.modifiee
							? t.fournieModifiee
							: t.fournie}
						{detail.modifiee && (
							<button type="button" className={s.lien} disabled={envoi} onClick={() => void revenir()}>
								{t.revenirOrigine}
							</button>
						)}
					</p>
				)}
				{nouvelle && (
					<fieldset className={s.portee}>
						<legend className={f.libelle}>{t.ouCreer}</legend>
						<div className={s.choix}>
							<input id={`${id}-memoire`} type="radio" name={`${id}-portee`} checked={!pourAgent} aria-describedby={`${id}-memoire-aide`} onChange={() => setPourAgent(false)} />
							<span>
								<label htmlFor={`${id}-memoire`}>{t.dansMemoire}</label>
								<small id={`${id}-memoire-aide`}>{t.dansMemoireAide}</small>
							</span>
						</div>
						<div className={s.choix}>
							<input id={`${id}-agent`} type="radio" name={`${id}-portee`} checked={pourAgent} aria-describedby={`${id}-agent-aide`} onChange={() => setPourAgent(true)} />
							<span>
								<label htmlFor={`${id}-agent`}>{t.pourAgent(p.agent)}</label>
								<small id={`${id}-agent-aide`}>{t.pourAgentAide}</small>
							</span>
						</div>
					</fieldset>
				)}
				{pret && (
					<>
						<div className={s.deuxC}>
							<div className={s.champ}>
								<label htmlFor={`${id}-icone`}>{t.icone}</label>
								<input id={`${id}-icone`} className={`${f.champTexte} ${s.icone}`} maxLength={16} value={saisie.icone} onChange={(e) => changer({ icone: e.target.value })} />
							</div>
							<div className={`${s.champ} ${s.large}`}>
								<label htmlFor={`${id}-nom`}>{t.nom}</label>
								<input
									id={`${id}-nom`}
									className={f.champTexte}
									placeholder={t.nomExemple}
									spellCheck={false}
									autoComplete="off"
									readOnly={fixe !== null}
									aria-describedby={fixe !== null ? `${id}-fixe` : `${id}-aide-nom`}
									value={saisie.nom}
									onChange={(e) => changer({ nom: e.target.value })}
								/>
								<small id={`${id}-aide-nom`}>{t.nomAide}</small>
							</div>
						</div>
						<div className={s.champ}>
							<label htmlFor={`${id}-desc`}>{t.quand}</label>
							<input
								id={`${id}-desc`}
								className={`${f.champTexte} ${s.prose}`}
								aria-describedby={`${id}-aide-desc`}
								placeholder={t.quandExemple}
								value={saisie.description}
								onChange={(e) => changer({ description: e.target.value })}
							/>
							<small id={`${id}-aide-desc`}>{t.quandAide}</small>
						</div>
						<div className={s.champ}>
							<label htmlFor={`${id}-contenu`}>{t.contenu}</label>
							<textarea
								id={`${id}-contenu`}
								className={`${f.texteLong} ${s.contenu}`}
								rows={10}
								placeholder={t.contenuExemple}
								value={saisie.contenu}
								onChange={(e) => changer({ contenu: e.target.value })}
							/>
						</div>
						<p className={f.discret}>{qui}</p>
					</>
				)}
				{conflit && (
					<div className={f.avis} role="alert">
						<p>{t.modifieeAilleurs}</p>
						<div className={f.actions}>
							<Bouton petit onClick={() => void lire()}>
								{t.recharger}
							</Bouton>
						</div>
					</div>
				)}
				{erreur !== null && (
					<p className={f.erreur} role="alert">
						{erreur}
					</p>
				)}
				{abandon && (
					<div className={f.avis} role="alert">
						<p>{t.abandonnerSaisie}</p>
						<div className={f.actions}>
							<Bouton petit onClick={fermer}>
								{t.abandonner}
							</Bouton>
							<Bouton petit genre="primaire" onClick={() => setAbandon(false)}>
								{t.continuer}
							</Bouton>
						</div>
					</div>
				)}
				{fixe !== null && (
					<p id={`${id}-fixe`} className={f.discret}>
						{fixe.charAt(0).toUpperCase() + fixe.slice(1)}.
					</p>
				)}
				<div className={s.actionsEd}>
					{detail !== null && (
						<Bouton className={s.supprimer} disabled={envoi} indisponible={fixe !== null && { raison: `${id}-fixe` }} onClick={supprimer}>
							{!confirmer ? textes.commun.actions.supprimer : touches > 0 ? t.retirerAussi(touches) : t.confirmerSuppression}
						</Bouton>
					)}
					<span className={s.espace} />
					<Bouton disabled={envoi} onClick={demanderFermeture}>
						{textes.commun.actions.annuler}
					</Bouton>
					<Bouton type="submit" genre="primaire" disabled={envoi} indisponible={raison !== null && { raison: `${id}-raison` }}>
						{nouvelle ? t.creer : textes.commun.actions.enregistrer}
					</Bouton>
				</div>
				{raison !== null && (
					<p id={`${id}-raison`} className={`${f.discret} ${s.raison}`}>
						{raison}
					</p>
				)}
			</form>
		</dialog>
	);
}
