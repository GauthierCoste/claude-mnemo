/**
 * Barre du haut de la vue Sessions (`.stop`) : décompte, « N terminées » (ouvre la liste des terminées), bascules Dossier et
 * Contexte, « + Nouvelle session ».
 */
import type { SessionVue } from '@mnemo/contrat';
import type { ReactNode } from 'react';
import { libelleTerminees } from '../../sessions/etats.ts';
import { Bascule } from '../commun/Bascule.tsx';
import { Bouton } from '../commun/Bouton.tsx';
import s from './BarreEtats.module.css';

/** « 8 sessions | 2 attendent une réponse | 2 travaillent », au singulier quand il le faut. */
export function decompte(sessions: readonly SessionVue[]): string {
	const attendent = sessions.filter((x) => x.etat === 'attend').length;
	const travaillent = sessions.filter((x) => x.etat === 'travaille').length;
	return [
		`${sessions.length} session${sessions.length > 1 ? 's' : ''}`,
		`${attendent} ${attendent > 1 ? 'attendent' : 'attend'} une réponse`,
		`${travaillent} ${travaillent > 1 ? 'travaillent' : 'travaille'}`,
	].join(' | ');
}

export function BarreEtats(p: {
	sessions: readonly SessionVue[];
	/** Sessions terminées (historique) ; aucune : rien d'affiché. */
	terminees: number;
	surTerminees(): void;
	dossier: boolean;
	contexte: boolean;
	surDossier(actif: boolean): void;
	surContexte(actif: boolean): void;
	surNouvelle(): void;
}): ReactNode {
	return (
		<div className={s.barre}>
			<span className={s.decompte}>{decompte(p.sessions)}</span>
			{p.terminees > 0 && (
				<button type="button" className={s.terminees} onClick={p.surTerminees}>
					{libelleTerminees(p.terminees)}
				</button>
			)}
			<span className={s.espace} />
			<Bascule actif={p.dossier} surChangement={p.surDossier}>
				Dossier
			</Bascule>
			<Bascule actif={p.contexte} surChangement={p.surContexte}>
				Contexte
			</Bascule>
			<Bouton petit onClick={p.surNouvelle}>
				+ Nouvelle session
			</Bouton>
		</div>
	);
}
