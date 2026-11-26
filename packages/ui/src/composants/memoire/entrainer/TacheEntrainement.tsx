/**
 * Bandeau de la tâche en cours (une seule à la fois) : l'opération réelle, avec le reflet des actions en cours, sa progression
 * (« 12 sur 30 », barre ; sans total connu, le nom seul), depuis quand, et « Arrêter ». Son texte (`id`) est la raison des
 * gestes de la page indisponibles pendant la tâche.
 */
import type { TacheEntrainementVue } from '@mnemo/contrat';
import type { CSSProperties, ReactNode } from 'react';
import { useActionsEntrainement } from '../../../client/hooks.ts';
import { NOMS_TACHES } from '../../../memoire/entrainement.ts';
import { Bouton } from '../../commun/Bouton.tsx';
import r from '../../commun/Reflet.module.css';
import s from './Entrainer.module.css';
import { useGeste } from './useGeste.ts';

const heure = (iso: string): string => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** Ce que garde un arrêt : les messages préparés et les propositions enregistrées ; un apprentissage arrêté n'écrit rien. */
const ARRET: Record<TacheEntrainementVue['genre'], string> = {
	preparer: 'Arrêter garde les messages déjà préparés.',
	prejuger: 'Arrêter garde les propositions déjà reçues.',
	apprendre: 'Arrêter laisse le modèle actuel en place.',
};

export function TacheEntrainement(p: { tache: TacheEntrainementVue; id: string }): ReactNode {
	const t = p.tache;
	const actions = useActionsEntrainement();
	const geste = useGeste();
	const connu = t.total > 0;
	const part = connu ? Math.min(1, t.fait / t.total) : 0;
	return (
		<section className={s.tache} aria-label="Tâche en cours">
			<p className={s.texteTache}>
				<span id={p.id}>
					<span className={r.reflet}>{NOMS_TACHES[t.genre]}…</span>
					{connu && <span className={s.compte}>{` ${t.fait} sur ${t.total}`}</span>}
				</span>
				<span className={s.discret}>depuis {heure(t.depuis)}</span>
			</p>
			<Bouton petit className={s.cible} disabled={geste.enCours !== null} onClick={() => void geste.agir('arreter', actions.arreter)}>
				Arrêter
			</Bouton>
			<div
				className={s.barre}
				data-indeterminee={!connu || undefined}
				role="progressbar"
				aria-label={NOMS_TACHES[t.genre]}
				{...(connu ? { 'aria-valuemin': 0, 'aria-valuemax': t.total, 'aria-valuenow': t.fait } : {})}
				style={{ '--part': part } as CSSProperties}
			/>
			<p className={s.aideTache}>{ARRET[t.genre]}</p>
			{geste.refus !== null && (
				<p className={s.refus} role="alert">
					{geste.refus.message}
				</p>
			)}
		</section>
	);
}
