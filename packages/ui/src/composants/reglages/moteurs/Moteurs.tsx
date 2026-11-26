/**
 * Réglages › Branchements, groupe « Moteurs » : une ligne par agent de code du service (logo, nom, fournisseur), avec l'état
 * de sa liaison à Mnemo sur ce poste (comme `mnemo verifier-poste`) et le geste qui la règle (« Lier à Mnemo », ou la commande
 * à copier) ; « Relire » vérifie de nouveau le poste, l'heure de la dernière vérification à côté.
 */
import { FOURNISSEURS_MOTEURS } from '@mnemo/commun';
import type { MoteurVue } from '@mnemo/contrat';
import { useEffect, useState, type ReactNode } from 'react';
import { useMoteurs } from '../../../client/hooks.ts';
import { actionDuMoteur, attendUnGeste, statutDuMoteur } from '../../../moteurs/circuit.ts';
import { LogoMoteur } from '../../../moteurs/logos.tsx';
import { Bouton } from '../../commun/Bouton.tsx';
import r from '../../commun/Reflet.module.css';
import c from '../Cartes.module.css';
import { ActionMoteur } from './ActionMoteur.tsx';

const heure = (d: Date): string => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export function Moteurs(): ReactNode {
	const ressource = useMoteurs(true);
	const moteurs = ressource.donnees?.moteurs;
	// à chaque lecture (la première, puis chaque « Relire ») : bouton désactivé, groupe occupé, statut visible
	const lecture = ressource.chargement;
	const [verifie, setVerifie] = useState<Date | null>(null);
	useEffect(() => {
		if (!lecture && ressource.donnees !== undefined && ressource.erreur === null) setVerifie(new Date());
	}, [lecture, ressource.donnees, ressource.erreur]);
	return (
		<section className={c.groupe} aria-labelledby="titre-moteurs" aria-busy={lecture}>
			<div className={c.teteGroupe}>
				<h3 id="titre-moteurs" className={c.titreGroupe}>
					Moteurs
				</h3>
				<span className={c.discret} role="status">
					{lecture ? (moteurs === undefined ? 'Vérification des moteurs… (quelques secondes)' : 'Vérification…') : verifie === null ? '' : `Vérifié à ${heure(verifie)}`}
				</span>
				<Bouton petit disabled={lecture} onClick={ressource.recharger}>
					<span className={lecture ? r.reflet : undefined}>Relire</span>
				</Bouton>
			</div>
			{ressource.erreur !== null && (
				<p className={c.erreur} role="alert">
					État des moteurs illisible : {ressource.erreur}
				</p>
			)}
			<ul className={c.lignes} aria-label="Moteurs">
				{moteurs?.map((m) => (
					<LigneMoteur key={m.id} moteur={m} lecture={lecture} />
				))}
			</ul>
		</section>
	);
}

/** `lecture` : une vérification du poste en cours. */
function LigneMoteur(p: { moteur: MoteurVue; lecture: boolean }): ReactNode {
	const m = p.moteur;
	const statut = statutDuMoteur(m);
	const action = actionDuMoteur(m);
	const pret = statut.cle === 'pret';
	return (
		<li className={c.prise} aria-label={m.nom} data-statut={statut.cle}>
			<span className={c.logo}>
				<LogoMoteur moteur={m.id} />
			</span>
			<span className={c.ident}>
				<span className={c.nom}>{m.nom}</span>
				<span className={c.detailLigne}>
					{FOURNISSEURS_MOTEURS[m.id]}
					{!pret && ` · ${statut.libelle.toLocaleLowerCase('fr')}`}
				</span>
			</span>
			{/* une action par moteur : le retour d'une liaison reste quand l'étape qui bloque change avec la vue relue */}
			{action !== null ? (
				<ActionMoteur key={m.id} id={m.id} moteur={m.nom} action={action} statut={statut.libelle} eteint={!attendUnGeste(m)} lecture={p.lecture} />
			) : (
				<span className={c.droite}>{pret ? <span className={c.pret}>● prêt</span> : <span className={c.eteint}>{statut.libelle}</span>}</span>
			)}
		</li>
	);
}
