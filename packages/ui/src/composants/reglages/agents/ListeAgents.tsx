/**
 * Liste des agents (Réglages › Agents), dans le panneau, en deux groupes : la mémoire (l'archiviste, toujours présent) et
 * le travail (`travail` d'abord, l'agent par défaut) ; avatar, nom, moteur · modèle ; et « + Nouvel agent », qui ouvre la
 * saisie de son nom.
 */
import { NOMS_MOTEURS, PROFIL_ARCHIVISTE, PROFIL_TRAVAIL } from '@mnemo/commun';
import type { ProfilVue } from '@mnemo/contrat';
import { useState, type ReactNode } from 'react';
import { AvatarProfil } from '../../commun/AvatarProfil.tsx';
import { Bouton } from '../../commun/Bouton.tsx';
import { cx } from '../../commun/classes.ts';
import f from '../champs/Saisie.module.css';
import d from '../Panneau.module.css';

/** « Claude Code · opus », « Codex · par défaut ». */
const classeDe = (x: ProfilVue): string => `${NOMS_MOTEURS[x.moteur]} · ${x.modele === '' ? 'par défaut' : x.modele}`;

export function ListeAgents(p: {
	profils: ProfilVue[];
	choisi: string | null;
	surChoix(nom: string): void;
	/** Saisie du nom d'un nouvel agent ouverte (aucun agent choisi pendant ce temps). */
	creation: boolean;
	/** Demande d'ouvrir la saisie (retenue par la page si l'agent ouvert a des modifications non enregistrées). */
	surOuvrirNouveau(): void;
	surAnnulerNouveau(): void;
	/** Crée l'agent `nom` aux valeurs par défaut de `travail` ; rend le motif d'un refus, null si créé. */
	surNouveau(nom: string): Promise<string | null>;
}): ReactNode {
	const [saisie, setSaisie] = useState('');
	const [refus, setRefus] = useState<string | null>(null);
	const [envoi, setEnvoi] = useState(false);
	const memoire = p.profils.filter((x) => x.nom === PROFIL_ARCHIVISTE);
	// travail (l'agent par défaut) d'abord, puis les autres par nom
	const travail = p.profils.filter((x) => x.nom !== PROFIL_ARCHIVISTE).sort((a, b) => Number(b.nom === PROFIL_TRAVAIL) - Number(a.nom === PROFIL_TRAVAIL));
	const fermer = () => {
		setSaisie('');
		setRefus(null);
	};
	const creer = async () => {
		if (saisie.trim() === '') return;
		setEnvoi(true);
		const motif = await p.surNouveau(saisie.trim());
		setEnvoi(false);
		setRefus(motif);
		if (motif === null) setSaisie('');
	};
	const groupe = (id: string, titre: string, agents: ProfilVue[]) => (
		<section className={d.groupe} aria-labelledby={id}>
			<h3 id={id} className={d.titreGroupe}>
				{titre}
			</h3>
			<ul className={d.lignes}>
				{agents.map((x) => (
					<li key={x.nom}>
						<button type="button" className={d.ligne} aria-current={x.nom === p.choisi ? 'true' : undefined} onClick={() => p.surChoix(x.nom)}>
							<AvatarProfil avatar={x.avatar} taille={32} titre="" />
							<span className={d.identite}>
								<span className={d.nom}>
									{x.nom}
									{x.nom === PROFIL_TRAVAIL && <span className={d.badge}>par défaut</span>}
								</span>
								<span className={d.description} title={classeDe(x)}>
									{classeDe(x)}
								</span>
							</span>
						</button>
					</li>
				))}
			</ul>
		</section>
	);
	return (
		<nav className={d.liste} aria-label="Agents">
			{groupe('groupe-memoire', 'Mémoire', memoire)}
			{groupe('groupe-travail', 'Travail', travail)}
			{!p.creation ? (
				<button
					type="button"
					className={cx(d.ligne, d.ajout)}
					onClick={() => {
						fermer();
						p.surOuvrirNouveau();
					}}
				>
					+ Nouvel agent
				</button>
			) : (
				<form
					className={d.groupe}
					onSubmit={(e) => {
						e.preventDefault();
						void creer();
					}}
				>
					<label className={f.libelle} htmlFor="nom-nouvel-agent">
						Nom du nouvel agent
					</label>
					<input
						id="nom-nouvel-agent"
						className={f.champTexte}
						autoFocus
						spellCheck={false}
						placeholder="minuscules, chiffres, tirets"
						value={saisie}
						onChange={(e) => setSaisie(e.target.value)}
					/>
					{refus !== null && (
						<p className={f.erreur} role="alert">
							{refus}
						</p>
					)}
					<div className={f.actions}>
						<Bouton genre="primaire" type="submit" disabled={envoi || saisie.trim() === ''}>
							Créer
						</Bouton>
						<Bouton
							disabled={envoi}
							onClick={() => {
								fermer();
								p.surAnnulerNouveau();
							}}
						>
							Annuler
						</Bouton>
					</div>
				</form>
			)}
		</nav>
	);
}
