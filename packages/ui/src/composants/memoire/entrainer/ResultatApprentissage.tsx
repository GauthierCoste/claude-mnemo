/**
 * Le dernier apprentissage : quand, sur combien de messages, si son modèle a remplacé celui d'alors ou si celui-ci a été
 * gardé ; puis par niveau son état (puce), le verdict en clair quand il diffère de la note actuelle (modèle gardé), les
 * critères manqués en clair, et la table de fiabilité, repliée (la note prédite contre la part réellement utile).
 */
import type { ResultatApprentissageVue, TrancheFiabiliteVue } from '@mnemo/contrat';
import type { ReactNode } from 'react';
import { accorder, dateEtHeure, NOMS_ETATS_NOTE, NOMS_NIVEAUX_NOTE, pourcent, suiteDuVerdict, TONS_ETATS_NOTE } from '../../../memoire/entrainement.ts';
import { Puce } from '../../commun/Puce.tsx';
import s from './Entrainer.module.css';

type NiveauResultat = ResultatApprentissageVue['niveaux'][number];

/**
 * Ce qu'est devenu le modèle d'alors. Un modèle refusé ne remplace jamais un accepté : refusé à tous les niveaux, il a remplacé
 * un modèle qui ne donnait pas de % non plus, et la note reste sans %.
 */
function phraseRemplacement(r: ResultatApprentissageVue): string {
	if (!r.remplace) return 'Le modèle d’alors a été gardé.';
	if (r.niveaux.every((n) => !n.accepte)) return 'Toujours refusé : ce modèle remplace celui d’alors, sans % non plus, et ordonne le classement.';
	return 'Son modèle a remplacé le modèle d’alors.';
}

/** L'état du modèle appris pour ce niveau : accepté, refusé, ou rien d'appris (aucune fiche jugée pour ce niveau). */
const etatDu = (n: NiveauResultat) => (n.accepte ? 'accepte' : n.paires === 0 ? 'non_appris' : 'refuse');

export function ResultatApprentissage(p: { resultat: ResultatApprentissageVue }): ReactNode {
	const r = p.resultat;
	return (
		<section className={s.section} aria-labelledby="titre-resultat">
			<div className={s.teteSection}>
				<h3 id="titre-resultat" className={s.titreSection}>
					Dernier apprentissage
				</h3>
				<span className={s.discret}>
					{dateEtHeure(r.date)} – {accorder(r.messages, 'message')} de {accorder(r.sessions, 'session')}
				</span>
			</div>
			<p className={s.remplace}>{phraseRemplacement(r)}</p>
			<div className={s.grilleNiveaux}>
				{r.niveaux.map((n) => {
					const etat = etatDu(n);
					return (
						<div key={n.niveau} className={s.niveauResultat}>
							<h4 className={s.titreNiveau}>
								{NOMS_NIVEAUX_NOTE[n.niveau]}
								<Puce ton={TONS_ETATS_NOTE[etat]}>{NOMS_ETATS_NOTE[etat]}</Puce>
							</h4>
							{!r.remplace && <p className={s.verdict}>{suiteDuVerdict(n.verdict)}</p>}
							{n.criteres.length > 0 && (
								<>
									<p className={s.discret}>Ce qui a manqué :</p>
									<ul className={s.criteres}>
										{n.criteres.map((c) => (
											<li key={c}>{c}</li>
										))}
									</ul>
								</>
							)}
							{n.fiabilite.length > 0 && <Fiabilite tranches={n.fiabilite} />}
						</div>
					);
				})}
			</div>
		</section>
	);
}

/**
 * La table compte des jugements : une fiche jugée pour un message (la même fiche, jugée pour deux messages, compte deux fois),
 * notée hors de l'apprentissage. Son total est celui de ses lignes.
 */
function Fiabilite(p: { tranches: TrancheFiabiliteVue[] }): ReactNode {
	const total = p.tranches.reduce((n, t) => n + t.paires, 0);
	return (
		<details className={s.fiabilite}>
			<summary>Table de fiabilité ({accorder(total, 'jugement', 'jugements')})</summary>
			<table className={s.tableNombres}>
				<thead>
					<tr>
						<th scope="col">Note</th>
						<th scope="col" title="Une fiche jugée pour un message : la même fiche jugée pour deux messages compte deux fois">
							Jugements
						</th>
						<th scope="col">Note moyenne</th>
						<th scope="col">Réellement utiles</th>
					</tr>
				</thead>
				<tbody>
					{p.tranches.map((t) => (
						<tr key={t.de}>
							<td>{`${Math.round(t.de * 100)} – ${pourcent(t.a)}`}</td>
							<td>{t.paires}</td>
							<td>{t.paires === 0 ? '—' : pourcent(t.pMoyen)}</td>
							<td>{t.paires === 0 ? '—' : pourcent(t.frequence)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</details>
	);
}
