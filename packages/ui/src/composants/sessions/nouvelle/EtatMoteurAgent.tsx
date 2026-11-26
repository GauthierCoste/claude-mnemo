/**
 * État du moteur d'un agent, en bas de sa fiche : « Prêt », ou ce qui bloque son lancement avec le geste qui le débloque
 * (« Lier à Mnemo », comme Réglages › Branchements) et « Voir dans Réglages » ; un point à régler qui n'empêche pas de
 * lancer ; la vérification du poste en cours, discrète (le choix reste libre). Le retour d'une liaison (déclaration laissée,
 * échec) reste dit quel que soit l'état qui suit. `idRaison` : l'élément qui dit pourquoi « Lancer » est indisponible.
 * L'annonce aux lecteurs d'écran est faite par la fiche : aucune région vivante ici, hors du retour de liaison.
 */
import type { IdMoteur } from '@mnemo/commun';
import { useEffect, type ReactNode } from 'react';
import type { EtatMoteurAgent as Etat } from '../../../sessions/agents.ts';
import { Bouton } from '../../commun/Bouton.tsx';
import r from '../../commun/Reflet.module.css';
import { useLiaisonMoteur } from '../../commun/useLiaisonMoteur.ts';
import s from './FicheAgent.module.css';

type Props = { id: IdMoteur; moteur: string; etat: Etat; verification: boolean; idRaison: string; surVoirReglages(): void };

export function EtatMoteurAgent(p: Props): ReactNode {
	const { enCours, retour, lier, effacer } = useLiaisonMoteur(p.id, p.moteur);
	useEffect(() => {
		if (p.verification) effacer();
	}, [p.verification, effacer]);
	const e = p.etat;
	const voir = (
		<Bouton petit className={s.cible} onClick={p.surVoirReglages}>
			Voir dans Réglages
		</Bouton>
	);
	// une vérification relancée alors que l'état est déjà connu : dite à côté, sans masquer l'état
	const enVerification = p.verification && e.genre !== 'verification' && <span className={`${s.verif} ${r.reflet}`}>vérification…</span>;
	const retourLiaison = retour !== null && (
		<ul className={s.retour} role={retour.alerte ? 'alert' : 'status'}>
			{retour.messages.map((m) => (
				<li key={m}>{m}</li>
			))}
		</ul>
	);

	if (e.genre === 'verification') {
		return (
			<p className={s.etat} data-genre="verification">
				<span className={r.reflet}>{`Vérification de ${p.moteur} sur ce poste…`}</span>
			</p>
		);
	}
	if (e.genre === 'pret' || e.genre === 'manuel') {
		return (
			<div className={s.etat} data-genre={e.genre === 'pret' ? 'pret' : 'attention'}>
				<p className={s.ligne}>
					{e.genre === 'pret' ? `✓ Prêt : ${p.moteur} trouvé et lié à Mnemo.` : `${p.moteur} introuvable ici : la session sera suivie, et tu la lanceras toi-même dans un terminal.`}
					{enVerification}
				</p>
				{retourLiaison}
			</div>
		);
	}
	if (e.genre === 'illisible' || e.genre === 'attention') {
		return (
			<div className={s.etat} data-genre="attention">
				<p className={s.titreEtat}>
					{e.genre === 'illisible' ? `État de ${p.moteur} illisible : ${e.motif}` : e.titre}
					{e.genre === 'attention' && e.motif !== null && <span className={s.motif}>{` ${e.motif}`}</span>}
					{enVerification}
				</p>
				<span className={s.actions}>{voir}</span>
				{retourLiaison}
			</div>
		);
	}
	return (
		<div className={s.etat} data-genre="bloque">
			<p id={p.idRaison} className={s.titreEtat}>
				{e.raison}
			</p>
			{e.lignes.length > 0 && (
				<ul className={s.lignes}>
					{e.lignes.map((l) => (
						<li key={l}>{l}</li>
					))}
				</ul>
			)}
			<span className={s.actions}>
				{e.lier && (
					<Bouton petit genre="primaire" className={`${s.cible} ${s.lier}`} disabled={enCours || p.verification} onClick={() => void lier()}>
						{enCours ? <span className={r.reflet}>Liaison…</span> : 'Lier à Mnemo'}
					</Bouton>
				)}
				{voir}
				{enVerification}
			</span>
			{retourLiaison}
		</div>
	);
}
