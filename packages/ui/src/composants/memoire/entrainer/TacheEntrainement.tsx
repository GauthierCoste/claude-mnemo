/**
 * Bandeau de la tâche en cours (une seule à la fois) : l'opération réelle, avec le reflet des actions en cours, sa progression
 * (« 12 sur 30 », barre ; sans total connu, le nom seul), depuis quand, et « Arrêter ». Son texte (`id`) est la raison des
 * gestes de la page indisponibles pendant la tâche.
 */
import type { TacheEntrainementVue } from '@mnemo/contrat';
import type { CSSProperties, ReactNode } from 'react';
import { useActionsEntrainement } from '../../../client/hooks.ts';
import { useTextes } from '../../../langue/langue.tsx';
import { Bouton } from '../../commun/Bouton.tsx';
import r from '../../commun/Reflet.module.css';
import s from './Entrainer.module.css';
import { useGeste } from './useGeste.ts';

export function TacheEntrainement(p: { tache: TacheEntrainementVue; id: string }): ReactNode {
	const textes = useTextes();
	const te = textes.memoire.entrainer;
	const t = p.tache;
	const nom = te.taches[t.genre];
	const actions = useActionsEntrainement();
	const geste = useGeste();
	const connu = t.total > 0;
	const part = connu ? Math.min(1, t.fait / t.total) : 0;
	return (
		<section className={s.tache} aria-label={te.tache.titre}>
			<p className={s.texteTache}>
				<span id={p.id}>
					<span className={r.reflet}>{te.tache.enCours(nom)}</span>
					{connu && <span className={s.compte}>{te.tache.compte(t.fait, t.total)}</span>}
				</span>
				<span className={s.discret}>{te.tache.depuis(textes.commun.formats.heure(Date.parse(t.depuis)))}</span>
			</p>
			<Bouton petit className={s.cible} disabled={geste.enCours !== null} onClick={() => void geste.agir('arreter', actions.arreter)}>
				{te.tache.arreter}
			</Bouton>
			<div
				className={s.barre}
				data-indeterminee={!connu || undefined}
				role="progressbar"
				aria-label={nom}
				{...(connu ? { 'aria-valuemin': 0, 'aria-valuemax': t.total, 'aria-valuenow': t.fait } : {})}
				style={{ '--part': part } as CSSProperties}
			/>
			<p className={s.aideTache}>{te.tache.arret[t.genre]}</p>
			{geste.refus !== null && (
				<p className={s.refus} role="alert">
					{geste.refus.message}
				</p>
			)}
		</section>
	);
}
