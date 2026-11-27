/**
 * Panneau du haut à gauche (`.ov`) : recherche, puis les blocs repliables en `<details>` : Lecture du graphe
 * (disposition, couleur, taille), Arbre (branche), Relations (masquables), Affichage (liens cassés, rotation,
 * densité des étiquettes, épingles).
 */
import { useState, type ReactNode, type RefObject, type SyntheticEvent } from 'react';
import type { Disposition } from '../../../graphe/disposition.ts';
import { DENSITES_ETIQUETTES, nomDeRelation, type GraphePrepare, type ModeCouleur, type ModeTaille } from '../../../graphe/donnees.ts';
import { useTextes } from '../../../langue/langue.tsx';
import { PLAFOND_FICHES } from '../../../graphe/plafond.ts';
import { Bascule } from '../../commun/Bascule.tsx';
import { Bouton } from '../../commun/Bouton.tsx';
import { cx } from '../../commun/classes.ts';
import s from './PilotageGraphe.module.css';
import { RechercheGraphe, type FiltresRecherche, type Recherche } from './RechercheGraphe.tsx';

/** Blocs repliés ou ouverts, gardés par visiteur. */
export const CLE_BLOCS = 'mnemo.graphe.blocs';

function lireBlocs(): Record<string, boolean> {
	try {
		const blocs: unknown = JSON.parse(window.localStorage.getItem(CLE_BLOCS) ?? '{}');
		return blocs && typeof blocs === 'object' ? (blocs as Record<string, boolean>) : {};
	} catch {
		return {};
	}
}

export function PilotageGraphe(p: {
	graphe: GraphePrepare;
	avis: string | null;
	grande: boolean;
	recherche: Recherche | null;
	texte: string;
	filtres: FiltresRecherche;
	saisie: RefObject<HTMLInputElement | null>;
	surTexte(texte: string): void;
	surFiltres(filtres: FiltresRecherche): void;
	surEffacer(): void;
	surResultat: Parameters<typeof RechercheGraphe>[0]['surResultat'];
	disposition: Disposition;
	surDisposition(d: Disposition): void;
	modeCouleur: ModeCouleur;
	surModeCouleur(m: ModeCouleur): void;
	modeTaille: ModeTaille;
	surModeTaille(m: ModeTaille): void;
	branche: string;
	surBranche(b: string): void;
	relationsMasquees: Set<string | null>;
	surRelation(relation: string): void;
	liensCasses: boolean;
	surLiensCasses(v: boolean): void;
	rotation: boolean;
	surRotation(v: boolean): void;
	densite: number;
	surDensite(cran: number): void;
	epingles: number;
	surLiberer(): void;
	surRecadrer(): void;
}): ReactNode {
	const textes = useTextes();
	const tg = textes.memoire.graphe;
	const t = tg.pilotage;
	const nombre = textes.commun.formats.nombre;
	const { graphe } = p;
	// Repliés par défaut, l'état lu une fois, écrit à chaque bascule.
	const [blocs, setBlocs] = useState(lireBlocs);
	const bloc = (nom: string) => ({
		'data-bloc': nom,
		open: blocs[nom] === true,
		onToggle: (e: SyntheticEvent<HTMLDetailsElement>) => {
			const ouvert = e.currentTarget.open;
			if (blocs[nom] === ouvert || (blocs[nom] === undefined && !ouvert)) return;
			const suivants = { ...lireBlocs(), [nom]: ouvert };
			setBlocs(suivants);
			try {
				window.localStorage.setItem(CLE_BLOCS, JSON.stringify(suivants));
			} catch {
				// Stockage refusé (navigation privée) : les blocs reprennent leur état par défaut au prochain chargement.
			}
		},
	});
	const avecNotions = graphe.notions.length > 0;
	const compteurs = t.compteurs(graphe.compteurs.fiches, graphe.compteurs.liens, graphe.compteurs.liensCasses, graphe.compteurs.sansRelation);
	const nomDensite = tg.densite(p.densite);

	return (
		<aside className={s.pilotage} aria-label={t.titre} onWheel={(e) => e.stopPropagation()}>
			<RechercheGraphe
				categories={graphe.categories}
				recherche={p.recherche}
				texte={p.texte}
				filtres={p.filtres}
				saisie={p.saisie}
				surTexte={p.surTexte}
				surFiltres={p.surFiltres}
				surEffacer={p.surEffacer}
				surResultat={p.surResultat}
				branche={p.branche}
			/>
			<p className={s.compteurs}>{compteurs}</p>
			{p.avis && <p className={cx(s.note, s.avis)}>{p.avis}</p>}

			<details className={s.bloc} {...bloc('lecture')}>
				<summary className={s.titre}>{t.lecture}</summary>
				<label className={s.champ}>
					<span className={s.lbl}>{t.disposition}</span>
					<select value={p.disposition} onChange={(e) => p.surDisposition(e.target.value as Disposition)}>
						<option value="forces">{t.dispositions.forces}</option>
						<option value="constellations">{t.dispositions.constellations}</option>
						{avecNotions && <option value="notions">{t.dispositions.notions}</option>}
						<option value="temps" title={t.dispositions.tempsTitre}>
							{t.dispositions.temps}
						</option>
					</select>
				</label>
				<label className={s.champ}>
					<span className={s.lbl}>{t.couleur}</span>
					<select value={p.modeCouleur} onChange={(e) => p.surModeCouleur(e.target.value as ModeCouleur)}>
						<option value="branche">{t.couleurs.branche}</option>
						<option value="sousdossier">{t.couleurs.sousdossier}</option>
						<option value="etat">{t.couleurs.etat}</option>
						<option value="periode">{t.couleurs.periode}</option>
						{avecNotions && <option value="notion">{t.couleurs.notion}</option>}
					</select>
				</label>
				<label className={s.champ}>
					<span className={s.lbl}>{t.taille}</span>
					<select value={p.modeTaille} onChange={(e) => p.surModeTaille(e.target.value as ModeTaille)}>
						<option value="relations">{t.tailles.relations}</option>
						<option value="faits">{t.tailles.faits}</option>
						<option value="uniforme">{t.tailles.uniforme}</option>
					</select>
				</label>
			</details>

			<details className={s.bloc} {...bloc('arbre')}>
				<summary className={s.titre}>{t.arbre}</summary>
				<label className={s.champ}>
					<span className={s.lbl}>{t.branche}</span>
					<select value={p.branche} onChange={(e) => p.surBranche(e.target.value)}>
						<option value="" disabled={p.grande}>
							{t.toutLeCoffre}
						</option>
						{graphe.branches.map(([branche, fiches]) => (
							<option key={branche} value={branche} disabled={p.grande && fiches > PLAFOND_FICHES}>
								{`${'  '.repeat(branche.split('/').length - 1)}${t.optionBranche(branche.split('/').pop() ?? branche, fiches)}`}
							</option>
						))}
					</select>
				</label>
			</details>

			<details className={s.bloc} {...bloc('relations')}>
				<summary className={s.titre}>{t.relations}</summary>
				{graphe.typesDeRelation.length === 0 && <p className={s.note}>{t.aucuneRelation}</p>}
				<div className={s.relations}>
					{graphe.typesDeRelation.map(([relation, total]) => {
						const masquee = p.relationsMasquees.has(relation);
						return (
							<button key={relation} type="button" className={cx(s.relation, masquee && s.masquee)} aria-pressed={!masquee} onClick={() => p.surRelation(relation)}>
								<span className={s.nomRelation}>{nomDeRelation(relation, tg)}</span>
								<span className={s.nombre}>{nombre(total)}</span>
							</button>
						);
					})}
				</div>
			</details>

			<details className={s.bloc} {...bloc('affichage')}>
				<summary className={s.titre}>{t.affichage}</summary>
				<Bascule actif={p.liensCasses} surChangement={p.surLiensCasses}>
					{t.liensCasses}
				</Bascule>
				<Bascule actif={p.rotation} surChangement={p.surRotation}>
					{t.rotation}
				</Bascule>
				<label className={s.champ}>
					<span className={s.lbl}>
						{t.etiquettes(<output>{nomDensite}</output>)}
					</span>
					<input
						type="range"
						min={0}
						max={DENSITES_ETIQUETTES.length - 1}
						step={1}
						value={p.densite}
						aria-valuetext={nomDensite}
						aria-keyshortcuts="L"
						onChange={(e) => p.surDensite(Number(e.target.value))}
					/>
				</label>
				<p className={s.note}>{t.epingles}</p>
				<div className={s.commandes}>
					{p.epingles > 0 && (
						<Bouton petit onClick={p.surLiberer}>
							{t.liberer(p.epingles)}
						</Bouton>
					)}
					<Bouton petit onClick={p.surRecadrer} aria-keyshortcuts="R">
						{t.recadrer}
					</Bouton>
				</div>
			</details>
		</aside>
	);
}
