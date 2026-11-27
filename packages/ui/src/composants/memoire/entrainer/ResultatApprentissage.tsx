/**
 * Le dernier apprentissage : quand, sur combien de messages, si son modèle a remplacé celui d'alors ou si celui-ci a été
 * gardé ; puis par niveau son état (puce), le verdict en clair quand il diffère de la note actuelle (modèle gardé), les
 * critères manqués en clair, et la table de fiabilité, repliée (la note prédite contre la part réellement utile).
 */
import type { ResultatApprentissageVue, TrancheFiabiliteVue } from '@mnemo/contrat';
import type { ReactNode } from 'react';
import { dateEtHeure, suiteDuVerdict, TONS_ETATS_NOTE, type TextesEntrainer } from '../../../memoire/entrainement.ts';
import { useTextes } from '../../../langue/langue.tsx';
import { Puce } from '../../commun/Puce.tsx';
import s from './Entrainer.module.css';

type NiveauResultat = ResultatApprentissageVue['niveaux'][number];

/**
 * Ce qu'est devenu le modèle d'alors. Un modèle refusé ne remplace jamais un accepté : refusé à tous les niveaux, il a remplacé
 * un modèle qui ne donnait pas de % non plus, et la note reste sans %.
 */
function phraseRemplacement(r: ResultatApprentissageVue, t: TextesEntrainer['resultat']): string {
	if (!r.remplace) return t.garde;
	if (r.niveaux.every((n) => !n.accepte)) return t.toujoursRefuse;
	return t.remplace;
}

/** L'état du modèle appris pour ce niveau : accepté, refusé, ou rien d'appris (aucune fiche jugée pour ce niveau). */
const etatDu = (n: NiveauResultat) => (n.accepte ? 'accepte' : n.paires === 0 ? 'non_appris' : 'refuse');

export function ResultatApprentissage(p: { resultat: ResultatApprentissageVue }): ReactNode {
	const te = useTextes().memoire.entrainer;
	const t = te.resultat;
	const r = p.resultat;
	return (
		<section className={s.section} aria-labelledby="titre-resultat">
			<div className={s.teteSection}>
				<h3 id="titre-resultat" className={s.titreSection}>
					{t.titre}
				</h3>
				<span className={s.discret}>
					{t.quand(dateEtHeure(r.date, te), r.messages, r.sessions)}
				</span>
			</div>
			<p className={s.remplace}>{phraseRemplacement(r, t)}</p>
			<div className={s.grilleNiveaux}>
				{r.niveaux.map((n) => {
					const etat = etatDu(n);
					return (
						<div key={n.niveau} className={s.niveauResultat}>
							<h4 className={s.titreNiveau}>
								{te.niveaux[n.niveau]}
								<Puce ton={TONS_ETATS_NOTE[etat]}>{te.etats[etat]}</Puce>
							</h4>
							{!r.remplace && <p className={s.verdict}>{suiteDuVerdict(n.verdict)}</p>}
							{n.criteres.length > 0 && (
								<>
									<p className={s.discret}>{t.manque}</p>
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
	const te = useTextes().memoire.entrainer;
	const tr = te.resultat;
	const total = p.tranches.reduce((n, t) => n + t.paires, 0);
	return (
		<details className={s.fiabilite}>
			<summary>{tr.fiabilite(total)}</summary>
			<table className={s.tableNombres}>
				<thead>
					<tr>
						<th scope="col">{tr.note}</th>
						<th scope="col" title={tr.jugementsTitre}>
							{tr.jugements}
						</th>
						<th scope="col">{tr.noteMoyenne}</th>
						<th scope="col">{tr.utiles}</th>
					</tr>
				</thead>
				<tbody>
					{p.tranches.map((t) => (
						<tr key={t.de}>
							<td>{tr.tranche(t.de, t.a)}</td>
							<td>{t.paires}</td>
							<td>{t.paires === 0 ? te.sansValeur : te.pourcent(t.pMoyen)}</td>
							<td>{t.paires === 0 ? te.sansValeur : te.pourcent(t.frequence)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</details>
	);
}
