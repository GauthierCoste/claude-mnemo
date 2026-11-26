/**
 * Historique des apprentissages (les 10 derniers, plus récents d'abord) : date, manuel ou automatique, état de chaque niveau,
 * modèle remplacé ou gardé (lignes rayées) ; l'erreur d'un essai en échec sous sa ligne. En vue étroite, chaque ligne
 * devient une carte aux rangées intitulées.
 */
import type { LigneHistoriqueVue, NiveauNoteVue } from '@mnemo/contrat';
import { Fragment, type ReactNode } from 'react';
import { dateEtHeure, NOMS_ETATS_NOTE, NOMS_NIVEAUX_NOTE, TONS_ETATS_NOTE } from '../../../memoire/entrainement.ts';
import { Puce } from '../../commun/Puce.tsx';
import s from './Entrainer.module.css';

const NIVEAUX: readonly NiveauNoteVue[] = ['complets', 'sens'];
const ORIGINES: Record<LigneHistoriqueVue['origine'], string> = { manuel: 'Manuel', automatique: 'Automatique' };

export function HistoriqueEntrainement(p: { lignes: readonly LigneHistoriqueVue[] }): ReactNode {
	return (
		<section className={s.section} aria-labelledby="titre-historique">
			<h3 id="titre-historique" className={s.titreSection}>
				Historique
			</h3>
			<table className={s.historique}>
				<thead>
					<tr>
						<th scope="col">Date</th>
						<th scope="col">Origine</th>
						{NIVEAUX.map((n) => (
							<th key={n} scope="col">
								{NOMS_NIVEAUX_NOTE[n]}
							</th>
						))}
						<th scope="col">Modèle</th>
					</tr>
				</thead>
				<tbody>
					{p.lignes.map((l, i) => (
						<Fragment key={`${l.date}-${i}`}>
							<tr data-echec={l.erreur !== undefined || undefined} data-raye={i % 2 === 0 || undefined}>
								<td data-titre="Date">{dateEtHeure(l.date)}</td>
								<td data-titre="Origine">{ORIGINES[l.origine]}</td>
								{NIVEAUX.map((n) => (
									<td key={n} data-titre={NOMS_NIVEAUX_NOTE[n]}>
										<Puce ton={TONS_ETATS_NOTE[l.verdicts[n]]}>{NOMS_ETATS_NOTE[l.verdicts[n]]}</Puce>
									</td>
								))}
								<td data-titre="Modèle">{l.erreur !== undefined ? 'Gardé (échec)' : l.remplace ? 'Remplacé' : 'Gardé'}</td>
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
