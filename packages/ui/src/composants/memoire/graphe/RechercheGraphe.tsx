/**
 * Recherche du graphe : filtre instantané sur titres et alias, filtres (état,
 * catégorie, liens), puis les faits trouvés par la recherche du service. Chaque résultat centre le graphe sur sa fiche.
 */
import { useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { TrouveVue } from '@mnemo/contrat';
import { ETATS, filtresActifs, type Noeud } from '../../../graphe/donnees.ts';
import { useTextes } from '../../../langue/langue.tsx';
import { Bouton } from '../../commun/Bouton.tsx';
import { DePlus, useToutPour } from '../../commun/DePlus.tsx';
import { cx } from '../../commun/classes.ts';
import { Pastille } from './Pastille.tsx';
import s from './RechercheGraphe.module.css';

const RESULTATS_AFFICHES = 60;

export type FiltresRecherche = { etat: string; categorie: string; liens: string };

export type Recherche = {
	ensemble: Set<Noeud>;
	ordre: Noeud[];
	parTitre: Noeud[];
	parMots: { trouve: TrouveVue; noeud: Noeud }[];
	enCours: boolean;
	erreur: string | null;
};

export function RechercheGraphe(p: {
	categories: [string, number][];
	recherche: Recherche | null;
	texte: string;
	filtres: FiltresRecherche;
	saisie: RefObject<HTMLInputElement | null>;
	surTexte(texte: string): void;
	surFiltres(filtres: FiltresRecherche): void;
	surEffacer(): void;
	surResultat(noeud: Noeud): void;
	/** Branche choisie dans l'Arbre : un filtre de plus. */
	branche: string;
}): ReactNode {
	const tg = useTextes().memoire.graphe;
	const t = tg.recherche;
	const [ouverte, setOuverte] = useState(false);
	const [filtresOuverts, setFiltresOuverts] = useState(false);
	const [actif, setActif] = useState(-1);
	const resultatsVus = useToutPour(p.texte);
	const limite = resultatsVus.tout ? Infinity : RESULTATS_AFFICHES;
	const nombreFiltres = filtresActifs({ ...p.filtres, branche: p.branche });
	const { recherche } = p;

	const resultats: { noeud: Noeud; extrait: string; section?: string }[] = [];
	let trouves = 0;
	if (recherche) {
		for (const noeud of recherche.parTitre.slice(0, limite)) {
			resultats.push({ noeud, extrait: noeud.alias.length ? t.alias(noeud.alias.join(', ')) : (noeud.chemin ?? '') });
		}
		const faits = recherche.parMots.filter(({ trouve, noeud }) => trouve.genre === 'fait' || !recherche.parTitre.includes(noeud));
		faits.slice(0, limite).forEach(({ trouve, noeud }, rang) => {
			resultats.push({ noeud, extrait: trouve.texte, ...(rang === 0 ? { section: t.dansLesInformations } : {}) });
		});
		trouves = recherche.parTitre.length + faits.length;
	}

	const effacer = () => {
		p.surEffacer();
		setFiltresOuverts(false);
		setActif(-1);
	};

	const clavier = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			if (resultats.length === 0) return;
			setActif((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + resultats.length) % resultats.length);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const choisi = resultats[Math.max(0, actif)];
			if (choisi) p.surResultat(choisi.noeud);
		} else if (e.key === 'Escape') {
			e.stopPropagation();
			effacer();
			e.currentTarget.blur();
		}
	};

	return (
		<div
			className={s.recherche}
			role="search"
			onFocus={() => setOuverte(true)}
			onBlur={(e) => {
				if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setOuverte(false);
			}}
		>
			<div className={s.ligne}>
				<input
					ref={p.saisie}
					type="search"
					className={s.saisie}
					value={p.texte}
					onChange={(e) => {
						p.surTexte(e.target.value);
						setActif(-1);
					}}
					onKeyDown={clavier}
					placeholder={t.indication}
					aria-label={t.chercher}
					aria-keyshortcuts="/"
					autoComplete="off"
					maxLength={500}
				/>
				<Bouton petit aria-expanded={filtresOuverts} onClick={() => setFiltresOuverts((o) => !o)}>
					{t.filtres(nombreFiltres)}
				</Bouton>
			</div>
			{filtresOuverts && (
				<div className={s.filtres}>
					<label className={s.champ}>
						<span className={s.lbl}>{t.etat}</span>
						<select value={p.filtres.etat} onChange={(e) => p.surFiltres({ ...p.filtres, etat: e.target.value })}>
							<option value="">{t.tousLesEtats}</option>
							{ETATS.map((etat) => (
								<option key={etat} value={etat}>
									{tg.etats[etat]}
								</option>
							))}
							<option value="aucun">{tg.legende.sansRemarque}</option>
						</select>
					</label>
					<label className={s.champ}>
						<span className={s.lbl}>{t.categorie}</span>
						<select value={p.filtres.categorie} onChange={(e) => p.surFiltres({ ...p.filtres, categorie: e.target.value })}>
							<option value="">{t.toutesLesCategories}</option>
							{p.categories.map(([categorie, fiches]) => (
								<option key={categorie} value={categorie}>
									{t.optionCategorie(categorie, fiches)}
								</option>
							))}
						</select>
					</label>
					<label className={s.champ}>
						<span className={s.lbl}>{t.liens}</span>
						<select value={p.filtres.liens} onChange={(e) => p.surFiltres({ ...p.filtres, liens: e.target.value })}>
							<option value="">{t.indifferent}</option>
							<option value="aucun">{t.sansRelation}</option>
							<option value="nombreux">{t.nombreux}</option>
							<option value="casses">{t.casses}</option>
						</select>
					</label>
				</div>
			)}
			{recherche && (
				<div className={s.etatRecherche}>
					<span role="status">
						{t.etatRecherche(recherche.ordre.length, recherche.enCours)}
					</span>
					<Bouton petit onClick={effacer}>
						{t.effacer}
					</Bouton>
				</div>
			)}
			{recherche && ouverte && (
				<div className={s.resultats}>
					{resultats.map(({ noeud, extrait, section }, rang) => (
						<div key={`${rang}:${noeud.id}`}>
							{section && <h3 className={s.section}>{section}</h3>}
							<button
								type="button"
								className={cx(s.resultat, rang === actif && s.actif)}
								onClick={(e) => {
									p.surResultat(noeud);
									e.currentTarget.blur();
								}}
							>
								<span className={s.resultatTitre}>
									<Pastille couleur={noeud.couleur} />
									<span>{noeud.titre}</span>
									<span className={s.nombre}>{noeud.branche || tg.legende.racine}</span>
								</span>
								<span className={s.extrait}>{extrait}</span>
							</button>
						</div>
					))}
					<DePlus nombre={trouves - resultats.length} surToutVoir={resultatsVus.toutVoir} />
					{recherche.erreur && <p className={cx(s.note, s.erreur)}>{t.erreur}</p>}
					{!recherche.erreur && resultats.length === 0 && !recherche.enCours && <p className={s.note}>{t.aucune}</p>}
				</div>
			)}
		</div>
	);
}
