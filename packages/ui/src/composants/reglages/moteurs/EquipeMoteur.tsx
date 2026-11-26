/**
 * Équipe d'un moteur : les profils dont les sessions tournent sur lui (avatars, nom en infobulle et pour les lecteurs d'écran),
 * et « Nouveau profil » pour en créer un dessus (Réglages › Profils).
 */
import type { IdMoteur } from '@mnemo/commun';
import type { ProfilVue } from '@mnemo/contrat';
import type { ReactNode } from 'react';
import { AvatarProfil } from '../../commun/AvatarProfil.tsx';
import { Bouton } from '../../commun/Bouton.tsx';
import s from './Moteurs.module.css';

export function EquipeMoteur(p: { id: IdMoteur; moteur: string; profils: readonly ProfilVue[] | undefined; installe: boolean; surNouveauProfil?(moteur: IdMoteur): void }): ReactNode {
	const equipe = (p.profils ?? []).filter((x) => x.moteur === p.id);
	return (
		<div>
			<h5 className={s.titreBloc}>Équipe</h5>
			<div className={s.equipe}>
				{equipe.length === 0 ? (
					<span className={s.vide}>{p.profils === undefined ? 'Lecture des profils…' : 'Aucun profil'}</span>
				) : (
					<ul className={s.avatars} aria-label={`Profils sur ${p.moteur}`}>
						{equipe.map((x) => (
							<li key={x.nom} title={x.nom}>
								<AvatarProfil avatar={x.avatar} taille={32} titre={x.nom} />
							</li>
						))}
					</ul>
				)}
				{p.installe && p.surNouveauProfil !== undefined && (
					<Bouton petit className={s.cible} aria-label={`Nouveau profil sur ${p.moteur}`} onClick={() => p.surNouveauProfil?.(p.id)}>
						+ Nouveau profil
					</Bouton>
				)}
			</div>
		</div>
	);
}
