/**
 * En-tête de la page Entraîner : la note de confiance de chaque niveau (Complets, Sens seul), en un mot (puce) et en une phrase,
 * avec d'où elle vient ; les deux niveaux sur une ligne quand ils disent la même chose ; dessous, tant qu'aucune n'est
 * acceptée, le bandeau d'avancement vers les vrais résultats. Le menu ⋯ porte le geste rare,
 * « Revenir au modèle d'avant » (s'il y en a un), réversible : pas de confirmation, un toast.
 */
import type { VueEntrainement } from '@mnemo/contrat';
import type { ReactNode } from 'react';
import { useActionsEntrainement } from '../../../client/hooks.ts';
import { lignesDeNote, nomsDesNiveaux, origineDeNote, suiteDuVerdict, TONS_ETATS_NOTE } from '../../../memoire/entrainement.ts';
import { useTextes } from '../../../langue/langue.tsx';
import { Puce } from '../../commun/Puce.tsx';
import { useToast } from '../../Toast.tsx';
import s from './Entrainer.module.css';
import { AvancementNote } from './AvancementNote.tsx';
import { MenuNote } from './MenuNote.tsx';
import { useGeste } from './useGeste.ts';

export function EnteteNote(p: { vue: VueEntrainement }): ReactNode {
	const t = useTextes().memoire.entrainer;
	const v = p.vue;
	const actions = useActionsEntrainement();
	const geste = useGeste();
	const toast = useToast();
	const revenir = async () => {
		if (await geste.agir('revenir', actions.revenir)) toast(t.entete.revenu);
	};
	const apprentissage = v.tache?.genre === 'apprendre';
	return (
		<header className={s.entete}>
			<div className={s.ligneTitre}>
				<h2 className={s.titre}>{t.entete.titre}</h2>
				{v.note.avant && (
					<MenuNote
						libelle={t.entete.revenir}
						detail={apprentissage ? t.entete.revenirIndisponible : t.entete.revenirDetail}
						indisponible={apprentissage || geste.enCours !== null}
						surChoix={() => void revenir()}
					/>
				)}
			</div>
			<ul className={s.niveaux}>
				{lignesDeNote(v.note.niveaux).map((l) => {
					const origine = origineDeNote(l.note, t);
					return (
						<li key={l.niveaux.join('+')} className={s.niveau}>
							<span className={s.nomNiveau}>{nomsDesNiveaux(l.niveaux, t)}</span>
							<Puce ton={TONS_ETATS_NOTE[l.note.etat]}>{t.etats[l.note.etat]}</Puce>
							<span className={s.verdict}>{suiteDuVerdict(l.note.verdict)}</span>
							{origine !== null && <span className={s.discret}>{origine}</span>}
						</li>
					);
				})}
			</ul>
			{v.avancement !== null && <AvancementNote avancement={v.avancement} />}
			{geste.refus !== null && (
				<p className={s.refus} role="alert">
					{geste.refus.message}
				</p>
			)}
		</header>
	);
}
