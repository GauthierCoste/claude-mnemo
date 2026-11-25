/**
 * Liste des profils de session (Réglages › Profils), en deux groupes : la mémoire (l'archiviste, toujours présent) et les
 * profils de travail (`travail` d'abord, le profil par défaut) ; avatar, nom, première ligne de la consigne ; et « Nouveau
 * profil de travail ».
 */
import { PROFIL_ARCHIVISTE, PROFIL_TRAVAIL } from '@mnemo/commun';
import type { ProfilVue } from '@mnemo/contrat';
import { useState, type ReactNode } from 'react';
import { AvatarProfil } from '../../commun/AvatarProfil.tsx';
import { Bouton } from '../../commun/Bouton.tsx';
import { moteurEtModele, moteurParticulier, nomDuMoteur } from '../../../moteurs/noms.ts';
import s from './Profils.module.css';

export function ListeProfils(p: {
	profils: ProfilVue[];
	choisi: string | null;
	surChoix(nom: string): void;
	/** Crée un profil `nom` aux valeurs par défaut de `travail` ; rend le motif d'un refus, null si créé. */
	surNouveau(nom: string): Promise<string | null>;
}): ReactNode {
	const [nouveau, setNouveau] = useState<string | null>(null);
	const [refus, setRefus] = useState<string | null>(null);
	const [envoi, setEnvoi] = useState(false);
	const memoire = p.profils.filter((x) => x.nom === PROFIL_ARCHIVISTE);
	// travail (le profil par défaut) d'abord, puis les autres par nom
	const travail = p.profils.filter((x) => x.nom !== PROFIL_ARCHIVISTE).sort((a, b) => Number(b.nom === PROFIL_TRAVAIL) - Number(a.nom === PROFIL_TRAVAIL));
	const creer = async () => {
		if (nouveau === null || nouveau.trim() === '') return;
		setEnvoi(true);
		const motif = await p.surNouveau(nouveau.trim());
		setEnvoi(false);
		setRefus(motif);
		if (motif === null) setNouveau(null);
	};
	return (
		<nav className={s.liste} aria-label="Profils">
			<section className={s.groupe} aria-labelledby="groupe-memoire">
				<h3 id="groupe-memoire" className={s.titreGroupe}>
					Mémoire
				</h3>
				<ul className={s.profils}>
				{memoire.map((x) => (
					<li key={x.nom}>
						<button type="button" className={s.ligneProfil} aria-current={x.nom === p.choisi ? 'true' : undefined} onClick={() => p.surChoix(x.nom)}>
							<AvatarProfil avatar={x.avatar} taille={32} titre="" />
							<span className={s.identite}>
								<span className={s.nomProfil}>
									{x.nom}
									{x.nom === PROFIL_TRAVAIL && <span className={s.badge}>par défaut</span>}
									{x.personnalise && <span className={s.badge}>personnalisé</span>}
								</span>
								<span className={s.description}>{x.description}</span>
							</span>
						</button>
					</li>
				))}
				</ul>
			</section>
			<section className={s.groupe} aria-labelledby="groupe-travail">
				<h3 id="groupe-travail" className={s.titreGroupe}>
					Travail
				</h3>
				<ul className={s.profils}>
				{travail.map((x) => (
					<li key={x.nom}>
						<button type="button" className={s.ligneProfil} aria-current={x.nom === p.choisi ? 'true' : undefined} onClick={() => p.surChoix(x.nom)}>
							<AvatarProfil avatar={x.avatar} taille={32} titre="" />
							<span className={s.identite}>
								<span className={s.nomProfil}>
									{x.nom}
									{x.nom === PROFIL_TRAVAIL && <span className={s.badge}>par défaut</span>}
									{x.personnalise && <span className={s.badge}>personnalisé</span>}
									{moteurParticulier(x) !== null && (
										<span className={s.badge} title={`Moteur : ${moteurEtModele(x)}`}>
											{nomDuMoteur(x.moteur)}
										</span>
									)}
								</span>
								<span className={s.description}>{x.description}</span>
							</span>
						</button>
					</li>
				))}
				</ul>
			{nouveau === null ? (
				<Bouton onClick={() => setNouveau('')}>Nouveau profil de travail</Bouton>
			) : (
				<form
					className={s.nouveau}
					onSubmit={(e) => {
						e.preventDefault();
						void creer();
					}}
				>
					<label className={s.libelle} htmlFor="nom-nouveau-profil">
						Nom du nouveau profil
					</label>
					<input
						id="nom-nouveau-profil"
						className={s.champTexte}
						autoFocus
						spellCheck={false}
						placeholder="minuscules, chiffres, tirets"
						value={nouveau}
						onChange={(e) => setNouveau(e.target.value)}
					/>
					{refus !== null && (
						<p className={s.erreur} role="alert">
							{refus}
						</p>
					)}
					<div className={s.actions}>
						<Bouton genre="primaire" type="submit" disabled={envoi || nouveau.trim() === ''}>
							Créer
						</Bouton>
						<Bouton
							disabled={envoi}
							onClick={() => {
								setNouveau(null);
								setRefus(null);
							}}
						>
							Annuler
						</Bouton>
					</div>
				</form>
			)}
			</section>
		</nav>
	);
}
