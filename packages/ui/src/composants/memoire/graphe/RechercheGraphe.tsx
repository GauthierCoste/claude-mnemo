/**
 * Recherche du graphe : filtre instantané sur titres et alias, filtres (état,
 * catégorie, liens), puis les faits trouvés par la recherche du service. Chaque résultat centre le graphe sur sa fiche.
 */
import { useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { TrouveVue } from '@mnemo/contrat';
import { ETATS, filtresActifs, RACINE, type Noeud } from '../../../graphe/donnees.ts';
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

const nombre = (n: number) => n.toLocaleString('fr-FR');

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
			resultats.push({ noeud, extrait: noeud.alias.length ? `alias : ${noeud.alias.join(', ')}` : (noeud.chemin ?? '') });
		}
		const faits = recherche.parMots.filter(({ trouve, noeud }) => trouve.genre === 'fait' || !recherche.parTitre.includes(noeud));
		faits.slice(0, limite).forEach(({ trouve, noeud }, rang) => {
			resultats.push({ noeud, extrait: trouve.texte, ...(rang === 0 ? { section: 'Dans les informations et le texte des fiches' } : {}) });
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
					placeholder="Titre, alias, informations ( / )"
					aria-label="Chercher dans la mémoire"
					aria-keyshortcuts="/"
					autoComplete="off"
					maxLength={500}
				/>
				<Bouton petit aria-expanded={filtresOuverts} onClick={() => setFiltresOuverts((o) => !o)}>
					{nombreFiltres ? `Filtres (${nombreFiltres})` : 'Filtres'}
				</Bouton>
			</div>
			{filtresOuverts && (
				<div className={s.filtres}>
					<label className={s.champ}>
						<span className={s.lbl}>État</span>
						<select value={p.filtres.etat} onChange={(e) => p.surFiltres({ ...p.filtres, etat: e.target.value })}>
							<option value="">Tous les états</option>
							{Object.entries(ETATS).map(([cle, { libelle }]) => (
								<option key={cle} value={cle}>
									{libelle}
								</option>
							))}
							<option value="aucun">Sans remarque</option>
						</select>
					</label>
					<label className={s.champ}>
						<span className={s.lbl}>Catégorie</span>
						<select value={p.filtres.categorie} onChange={(e) => p.surFiltres({ ...p.filtres, categorie: e.target.value })}>
							<option value="">Toutes les catégories</option>
							{p.categories.map(([categorie, fiches]) => (
								<option key={categorie} value={categorie}>
									{`${categorie} (${nombre(fiches)})`}
								</option>
							))}
						</select>
					</label>
					<label className={s.champ}>
						<span className={s.lbl}>Liens</span>
						<select value={p.filtres.liens} onChange={(e) => p.surFiltres({ ...p.filtres, liens: e.target.value })}>
							<option value="">Indifférent</option>
							<option value="aucun">Sans relation</option>
							<option value="nombreux">5 relations et plus</option>
							<option value="casses">Cite une fiche absente</option>
						</select>
					</label>
				</div>
			)}
			{recherche && (
				<div className={s.etatRecherche}>
					<span role="status">
						{`${nombre(recherche.ordre.length)} fiche${recherche.ordre.length > 1 ? 's' : ''}${recherche.enCours ? ', recherche dans les informations…' : ''}`}
					</span>
					<Bouton petit onClick={effacer}>
						Effacer
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
									<span className={s.nombre}>{noeud.branche || RACINE}</span>
								</span>
								<span className={s.extrait}>{extrait}</span>
							</button>
						</div>
					))}
					<DePlus nombre={trouves - resultats.length} surToutVoir={resultatsVus.toutVoir} />
					{recherche.erreur && <p className={cx(s.note, s.erreur)}>La recherche dans les informations n'a pas pu être faite.</p>}
					{!recherche.erreur && resultats.length === 0 && !recherche.enCours && <p className={s.note}>Aucune fiche ne correspond.</p>}
				</div>
			)}
		</div>
	);
}
