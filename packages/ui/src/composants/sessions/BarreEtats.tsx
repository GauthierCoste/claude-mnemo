/**
 * Barre du haut de la vue Sessions (`.stop`) : décompte, « N terminées » (ouvre la liste des terminées), les agents en cours
 * (`AgentsEnCours`, juste à gauche des bascules), bascules Dossier et Contexte, « + Nouvelle session ».
 */
import type { SessionVue } from '@mnemo/contrat';
import type { ReactNode } from 'react';
import { useTextes } from '../../langue/langue.tsx';
import { TEXTES, type Textes } from '../../langue/textes.ts';
import { Bascule } from '../commun/Bascule.tsx';
import { Bouton } from '../commun/Bouton.tsx';
import { AgentsEnCours } from './AgentsEnCours.tsx';
import s from './BarreEtats.module.css';

/** « 8 sessions | 2 attendent une réponse | 2 travaillent », au singulier quand il le faut. */
export function decompte(sessions: readonly SessionVue[], t: Textes['sessions'] = TEXTES.fr.sessions): string {
	const attendent = sessions.filter((x) => x.etat === 'attend').length;
	const travaillent = sessions.filter((x) => x.etat === 'travaille').length;
	return t.barre.decompte(sessions.length, attendent, travaillent);
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
	/** Sessions vivantes de tous les profils, archiviste compris (les agents en cours) ; absent : pas de rangée. */
	agents?: readonly SessionVue[];
	/** Clic sur un agent : sa session la plus urgente. */
	surAgent?(session: string, profil: string): void;
}): ReactNode {
	const t = useTextes().sessions;
	return (
		<div className={s.barre}>
			<span className={s.decompte}>{decompte(p.sessions, t)}</span>
			{p.terminees > 0 && (
				<button type="button" className={s.terminees} onClick={p.surTerminees}>
					{t.barre.terminees(p.terminees)}
				</button>
			)}
			<span className={s.espace} />
			{p.agents !== undefined && p.surAgent !== undefined && <AgentsEnCours sessions={p.agents} surAgent={p.surAgent} />}
			<Bascule actif={p.dossier} surChangement={p.surDossier}>
				{t.barre.dossier}
			</Bascule>
			<Bascule actif={p.contexte} surChangement={p.surContexte}>
				{t.barre.contexte}
			</Bascule>
			<Bouton petit onClick={p.surNouvelle}>
				{t.barre.nouvelle}
			</Bouton>
		</div>
	);
}
