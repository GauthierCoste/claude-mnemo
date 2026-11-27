/**
 * Historique des apprentissages (les 10 derniers, plus récents d'abord) : date, manuel ou automatique, état de chaque niveau,
 * modèle remplacé ou gardé (lignes rayées) ; l'erreur d'un essai en échec sous sa ligne. En vue étroite, chaque ligne
 * devient une carte aux rangées intitulées.
 */
import type { LigneHistoriqueVue, NiveauNoteVue } from '@mnemo/contrat';
import { Fragment, type ReactNode } from 'react';
import { dateEtHeure, TONS_ETATS_NOTE } from '../../../memoire/entrainement.ts';
import { useTextes } from '../../../langue/langue.tsx';
import { Puce } from '../../commun/Puce.tsx';
import s from './Entrainer.module.css';

const NIVEAUX: readonly NiveauNoteVue[] = ['complets', 'sens'];

export function HistoriqueEntrainement(p: { lignes: readonly LigneHistoriqueVue[] }): ReactNode {
	const te = useTextes().memoire.entrainer;
	const t = te.historique;
	return (
		<section className={s.section} aria-labelledby="titre-historique">
			<h3 id="titre-historique" className={s.titreSection}>
				{t.titre}
			</h3>
			<table className={s.historique}>
				<thead>
					<tr>
						<th scope="col">{t.date}</th>
						<th scope="col">{t.origine}</th>
						{NIVEAUX.map((n) => (
							<th key={n} scope="col">
								{te.niveaux[n]}
							</th>
						))}
						<th scope="col">{t.modele}</th>
					</tr>
				</thead>
				<tbody>
					{p.lignes.map((l, i) => (
						<Fragment key={`${l.date}-${i}`}>
							<tr data-echec={l.erreur !== undefined || undefined} data-raye={i % 2 === 0 || undefined}>
								<td data-titre={t.date}>{dateEtHeure(l.date, te)}</td>
								<td data-titre={t.origine}>{t.origines[l.origine]}</td>
								{NIVEAUX.map((n) => (
									<td key={n} data-titre={te.niveaux[n]}>
										<Puce ton={TONS_ETATS_NOTE[l.verdicts[n]]}>{te.etats[l.verdicts[n]]}</Puce>
									</td>
								))}
								<td data-titre={t.modele}>{l.erreur !== undefined ? t.gardeEchec : l.remplace ? t.remplace : t.garde}</td>
							</tr>
							{l.erreur !== undefined && (
								<tr className={s.ligneErreur} data-raye={i % 2 === 0 || undefined}>
									<td colSpan={NIVEAUX.length + 3}>{l.erreur}</td>
								</tr>
							)}
						</Fragment>
					))}
				</tbody>
			</table>
		</section>
	);
}
