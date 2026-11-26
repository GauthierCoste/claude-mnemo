/**
 * Le geste d'un moteur qui n'est pas prêt, dans sa ligne (Réglages › Branchements) : à droite, « Lier à Mnemo » ou « Copier »
 * la commande (sinon rien) ; sous son nom, pourquoi ça bloque. « Lier à Mnemo » (serveur MCP et hooks du
 * poste) : désactivé pendant l'appel (avec le reflet des actions en cours) et pendant une vérification du poste ; lié, un
 * toast ; une déclaration de l'utilisateur laissée ou une étape en échec, leurs messages ici (en alerte pour un échec), gardés
 * quand l'étape qui bloque change avec la vue relue, jusqu'à la vérification suivante ; la commande à lancer soi-même reste
 * en repli discret.
 */
import type { IdMoteur } from '@mnemo/commun';
import { useEffect, type ReactNode } from 'react';
import type { ActionMoteur as Action } from '../../../moteurs/circuit.ts';
import { Bouton } from '../../commun/Bouton.tsx';
import { copierTexte } from '../../commun/copier.ts';
import r from '../../commun/Reflet.module.css';
import { useLiaisonMoteur } from '../../commun/useLiaisonMoteur.ts';
import { useToast } from '../../Toast.tsx';
import c from '../Cartes.module.css';
import s from './Moteurs.module.css';

/** `lecture` : une vérification du poste en cours (« Relire »). */
export function ActionMoteur(p: { id: IdMoteur; moteur: string; action: Action; lecture: boolean }): ReactNode {
	const a = p.action;
	const toast = useToast();
	const { enCours, retour, lier, effacer } = useLiaisonMoteur(p.id, p.moteur);
	const copier = (texte: string) => copierTexte(texte, toast, 'Commande copiée.');
	// une nouvelle vérification du poste : le retour de la dernière liaison n'est plus à jour
	useEffect(() => {
		if (p.lecture) effacer();
	}, [p.lecture, effacer]);

	const commande = a.commande;
	const ouDans = commande?.dans === 'moteur' ? `À taper dans ${p.moteur} :` : a.geste === 'lier' ? 'Ou dans un terminal :' : 'Dans un terminal :';
	return (
		<>
			<span className={c.droite}>
				{a.geste === 'lier' && (
					<Bouton petit genre="primaire" disabled={enCours || p.lecture} onClick={() => void lier()}>
						{enCours ? <span className={r.reflet}>Liaison…</span> : 'Lier à Mnemo'}
					</Bouton>
				)}
				{a.geste === 'copier' && commande !== null && (
					<Bouton petit aria-label={`Copier « ${commande.texte} »`} onClick={() => copier(commande.texte)}>
						Copier « {commande.texte} »
					</Bouton>
				)}
			</span>
			<div className={c.sousLigne}>
				<p className={s.motif}>
					{a.titre}
					{a.motif !== null && ` ${a.motif}`}
				</p>
				{retour !== null && (
					<ul className={s.retour} role={retour.alerte ? 'alert' : 'status'}>
						{retour.messages.map((m) => (
							<li key={m}>{m}</li>
						))}
					</ul>
				)}
				{commande !== null && (
					<p className={s.repli}>
						<span>{ouDans}</span>
						<code>{commande.texte}</code>
						{a.geste === 'lier' && (
							<Bouton petit aria-label={`Copier « ${commande.texte} »`} onClick={() => copier(commande.texte)}>
								Copier
							</Bouton>
						)}
						<span>puis « Relire ».</span>
					</p>
				)}
			</div>
		</>
	);
}
