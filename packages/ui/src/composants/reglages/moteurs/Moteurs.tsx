/**
 * Réglages › Branchements, groupe « Moteurs » : une ligne par agent de code du service (logo, nom, fournisseur), avec l'état
 * de sa liaison à Mnemo sur ce poste (comme `mnemo verifier-poste`) et le geste qui la règle (« Lier à Mnemo », ou la commande
 * à copier) ; « Relire » vérifie de nouveau le poste, l'heure de la dernière vérification à côté.
 */
import { FOURNISSEURS_MOTEURS } from '@mnemo/commun';
import type { MoteurVue } from '@mnemo/contrat';
import { useEffect, useState, type ReactNode } from 'react';
import { useMoteurs } from '../../../client/hooks.ts';
import { useLangue, useTextes } from '../../../langue/langue.tsx';
import { actionDuMoteur, statutDuMoteur } from '../../../moteurs/circuit.ts';
import { LogoMoteur } from '../../../moteurs/logos.tsx';
import { Bouton } from '../../commun/Bouton.tsx';
import r from '../../commun/Reflet.module.css';
import c from '../Cartes.module.css';
import { ActionMoteur } from './ActionMoteur.tsx';

export function Moteurs(): ReactNode {
	const t = useTextes();
	const m = t.reglages.moteurs;
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
					{m.titre}
				</h3>
				<span className={c.discret} role="status">
					{lecture ? (moteurs === undefined ? m.premiereVerification : m.verification) : verifie === null ? '' : m.verifie(t.commun.formats.heure(verifie.getTime()))}
				</span>
				<Bouton petit disabled={lecture} onClick={ressource.recharger}>
					<span className={lecture ? r.reflet : undefined}>{m.relire}</span>
				</Bouton>
			</div>
			{ressource.erreur !== null && (
				<p className={c.erreur} role="alert">
					{m.illisible(ressource.erreur)}
				</p>
			)}
			<ul className={c.lignes} aria-label={m.titre}>
				{moteurs?.map((x) => (
					<LigneMoteur key={x.id} moteur={x} lecture={lecture} />
				))}
			</ul>
		</section>
	);
}

/** `lecture` : une vérification du poste en cours. */
function LigneMoteur(p: { moteur: MoteurVue; lecture: boolean }): ReactNode {
	const { langue, t } = useLangue();
	const m = p.moteur;
	const statut = statutDuMoteur(m, t);
	const action = actionDuMoteur(m, t);
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
					{/* sans geste (pas installé, introuvable…), la phrase sous la ligne le dit : le statut n'est pas répété ici */}
					{!pret && (action === null || action.geste !== null) && ` · ${statut.libelle.toLocaleLowerCase(langue)}`}
				</span>
			</span>
			{/* une action par moteur : le retour d'une liaison reste quand l'étape qui bloque change avec la vue relue */}
			{action !== null ? (
				<ActionMoteur key={m.id} id={m.id} moteur={m.nom} action={action} lecture={p.lecture} />
			) : (
				pret && (
					<span className={c.droite}>
						<span className={c.pret}>{t.reglages.moteurs.pret}</span>
					</span>
				)
			)}
		</li>
	);
}
