/**
 * L'encadré d'action d'un moteur, pour sa première étape cassée : pourquoi elle bloque, et le geste qui la débloque.
 * « Lier à Mnemo » (serveur MCP et hooks du poste) : désactivé pendant l'appel, avec le reflet des actions en cours ; lié, un
 * toast ; une déclaration de l'utilisateur laissée ou une étape en échec, leurs messages ici (en alerte pour un échec) ; la
 * commande à lancer soi-même reste en repli discret. Sinon « Copier » la commande (dans un terminal, ou à taper dans le moteur).
 */
import type { IdMoteur } from '@mnemo/commun';
import type { EtapeLiaisonVue, LiaisonMoteurVue } from '@mnemo/contrat';
import { useState, type ReactNode } from 'react';
import { ErreurApi } from '../../../client/api.ts';
import { useLierMoteur } from '../../../client/hooks.ts';
import type { ActionMoteur as Action } from '../../../moteurs/circuit.ts';
import { Bouton } from '../../commun/Bouton.tsx';
import { copierTexte } from '../../commun/copier.ts';
import r from '../../commun/Reflet.module.css';
import { useToast } from '../../Toast.tsx';
import s from './Moteurs.module.css';

/** Ce que la dernière liaison a laissé à dire : les étapes laissées ou en échec, ou le refus du service. */
type Retour = { alerte: boolean; messages: string[] };

function retourDe(l: LiaisonMoteurVue): Retour | null {
	const etapes = [l.mcp, l.hooks].filter((e): e is EtapeLiaisonVue => e !== undefined && (e.resultat === 'laisse' || e.resultat === 'echec'));
	if (l.lie && etapes.length === 0) return null;
	return { alerte: !l.ok, messages: etapes.length > 0 ? etapes.map((e) => e.message) : ['Liaison incomplète.'] };
}

export function ActionMoteur(p: { id: IdMoteur; moteur: string; action: Action }): ReactNode {
	const a = p.action;
	const toast = useToast();
	const lier = useLierMoteur();
	const [enCours, setEnCours] = useState(false);
	const [retour, setRetour] = useState<Retour | null>(null);
	const copier = (texte: string) => copierTexte(texte, toast, 'Commande copiée.');

	const surLier = async () => {
		setEnCours(true);
		setRetour(null);
		try {
			const l = await lier(p.id);
			if (l.lie) toast(`${p.moteur} lié à Mnemo.`);
			setRetour(retourDe(l));
		} catch (e) {
			setRetour({ alerte: true, messages: [e instanceof ErreurApi ? e.message : `Liaison de ${p.moteur} impossible.`] });
		} finally {
			setEnCours(false);
		}
	};

	const commande = a.commande;
	const ouDans = commande?.dans === 'moteur' ? `À taper dans ${p.moteur} :` : a.geste === 'lier' ? 'Ou dans un terminal :' : 'Dans un terminal :';
	return (
		<div className={s.action} data-neutre={a.etape === 'commande' || undefined}>
			<p className={s.texteAction}>
				<span className={s.titreAction}>{a.titre}</span>
				{a.motif !== null && ` ${a.motif}`}
			</p>
			{a.geste === 'lier' && (
				<Bouton petit className={`${s.geste} ${s.cible}`} disabled={enCours} onClick={() => void surLier()}>
					{enCours ? <span className={r.reflet}>Liaison…</span> : 'Lier à Mnemo'}
				</Bouton>
			)}
			{a.geste === 'copier' && commande !== null && (
				<Bouton petit className={`${s.geste} ${s.cible}`} aria-label={`Copier « ${commande.texte} »`} onClick={() => copier(commande.texte)}>
					Copier « {commande.texte} »
				</Bouton>
			)}
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
						<Bouton petit className={s.cible} aria-label={`Copier « ${commande.texte} »`} onClick={() => copier(commande.texte)}>
							Copier
						</Bouton>
					)}
					<span>puis « Relire ».</span>
				</p>
			)}
		</div>
	);
}
