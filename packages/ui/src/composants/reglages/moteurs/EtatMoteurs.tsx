/**
 * Réglages › Système › Moteurs : une carte par agent de code du service, avec l'état de sa liaison à Mnemo sur ce poste
 * (comme `mnemo verifier-poste`) et le geste qui la règle (« Lier à Mnemo », ou la commande à copier) ; « Relire » vérifie
 * de nouveau le poste, l'heure de la dernière vérification à côté.
 */
import { IDS_MOTEURS, NOMS_MOTEURS } from '@mnemo/commun';
import type { IdMoteur } from '@mnemo/commun';
import { useEffect, useState, type ReactNode } from 'react';
import { useMoteurs, useProfils } from '../../../client/hooks.ts';
import { FOURNISSEURS_MOTEURS } from '../../../moteurs/fournisseurs.ts';
import { Bouton } from '../../commun/Bouton.tsx';
import r from '../../commun/Reflet.module.css';
import { CarteMoteur } from './CarteMoteur.tsx';
import s from './Moteurs.module.css';

const SOUS_TITRE = `Les agents de code qui font tourner les sessions, un par fournisseur : ${IDS_MOTEURS.map((m) => `${NOMS_MOTEURS[m]} (${FOURNISSEURS_MOTEURS[m]})`).join(', ')}. Un moteur est prêt quand son circuit est allumé jusqu’au bout.`;

const heure = (d: Date): string => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** `surNouveauProfil` : ouvre Réglages › Profils pour créer un profil sur ce moteur. */
export function EtatMoteurs(p: { surNouveauProfil?(moteur: IdMoteur): void }): ReactNode {
	const ressource = useMoteurs(true);
	const profils = useProfils().donnees?.profils;
	const moteurs = ressource.donnees?.moteurs;
	// à chaque lecture (la première, puis chaque « Relire ») : bouton désactivé, section occupée, statut visible
	const lecture = ressource.chargement;
	const [verifie, setVerifie] = useState<Date | null>(null);
	useEffect(() => {
		if (!lecture && ressource.donnees !== undefined && ressource.erreur === null) setVerifie(new Date());
	}, [lecture, ressource.donnees, ressource.erreur]);
	return (
		<section className={s.moteurs} aria-labelledby="titre-moteurs" aria-busy={lecture}>
			<div className={s.tete}>
				<h3 id="titre-moteurs" className={s.titre}>
					Moteurs
				</h3>
				<div className={s.verification}>
					<span role="status">{lecture ? (moteurs === undefined ? 'Vérification des moteurs… (quelques secondes)' : 'Vérification…') : verifie === null ? '' : `Vérifié à ${heure(verifie)}`}</span>
					<Bouton petit className={s.cible} disabled={lecture} onClick={ressource.recharger}>
						<span className={lecture ? r.reflet : undefined}>Relire</span>
					</Bouton>
				</div>
				<p className={s.sous}>{SOUS_TITRE}</p>
			</div>
			{ressource.erreur !== null && (
				<p className={s.erreur} role="alert">
					État des moteurs illisible : {ressource.erreur}
				</p>
			)}
			<div className={s.grille}>
				{moteurs?.map((m) => (
					<CarteMoteur key={m.id} moteur={m} profils={profils} {...(p.surNouveauProfil ? { surNouveauProfil: p.surNouveauProfil } : {})} />
				))}
			</div>
		</section>
	);
}
