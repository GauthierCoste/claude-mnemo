/**
 * Palette (⌘K, Ctrl+K hors macOS, ou le champ `.cmd` de la barre de titre) : un champ posé sur celui de la barre de titre
 * et, juste dessous, un menu de même bord gauche et de même largeur. Résultats : les sessions qui correspondent nettement
 * (les vivantes, puis les terminées, avec leur état), puis le classement du moteur de recherche du service (mots seuls d'abord, puis sens et reranker s'ils
 * tournent ; arrêtés, la recherche du service les relance en arrière-plan pour la suivante, et la palette propose de les
 * démarrer tout de suite), les éléments d'une même fiche regroupés sous elle ; les
 * fiches au titre correspondant ne s'affichent que le temps qu'il réponde. Filtres : Tout, Sessions, Fiches, Documents,
 * « Ce projet » (session choisie ou fiche ouverte). Flèches pour choisir, Entrée pour ouvrir, Échap pour fermer. Une
 * session s'ouvre en grand dans la grille (l'archiviste : son tiroir), une fiche ou un élément dans Mémoire › Fichiers.
 */
import type { TrouveRechercheVue } from '@mnemo/contrat';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { PROFIL_ARCHIVISTE } from '@mnemo/commun';
import { useGraphe, useModeles, useSessionsConnues } from '../client/hooks.ts';
import { useTextes } from '../langue/langue.tsx';
import type { Textes } from '../langue/textes.ts';
import { useNavigation } from '../navigation.tsx';
import { positionMenu, useRectAncre } from '../palette/ancrage.ts';
import { cheminCourt, corpsDe, extrait, libelleGenre, surligner, titreDe, type Segment } from '../palette/presentation.ts';
import { demandeAuMoteur, estDocument, FILTRES, motsDe, projetUtilisable, resultatsPalette, type Filtre, type Resultat } from '../palette/resultats.ts';
import { useRechercheMoteur } from '../palette/useRechercheMoteur.ts';
import { pourcentage } from '../sessions/classement.ts';
import { cx } from './commun/classes.ts';
import { DePlus, useToutPour } from './commun/DePlus.tsx';
import { avisModeles } from './modeles/avis-modeles.ts';
import s from './Palette.module.css';
import { useOuvrirSession } from './sessions/ouvrir-session.ts';
import { Point } from './sessions/Point.tsx';

/**
 * `texteInitial` : mode démo (`&palette=stocks`), texte de la première ouverture ; `ancre` : le champ de la barre de
 * titre, sur lequel la palette se pose.
 */
export function Palette(p: { texteInitial?: string; ancre?: RefObject<HTMLElement | null> }): ReactNode {
	const nav = useNavigation();
	const [initial, setInitial] = useState(p.texteInitial ?? '');
	if (!nav.paletteOuverte) return null;
	return <PaletteOuverte texteInitial={initial} surOuverture={() => initial && setInitial('')} ancre={p.ancre} />;
}

function PaletteOuverte(p: { texteInitial: string; surOuverture(): void; ancre: RefObject<HTMLElement | null> | undefined }): ReactNode {
	const nav = useNavigation();
	const textes = useTextes();
	const t = textes.coquille.palette;
	const racine = textes.coquille.arbre.racine;
	const ouvrirSession = useOuvrirSession();
	// les terminées de l'historique aussi : elles se trouvent par leur objectif, après les vivantes
	const connues = useSessionsConnues();
	const graphe = useGraphe();
	const [q, setQ] = useState(p.texteInitial);
	const [filtre, setFiltre] = useState<Filtre>('tout');
	const [ceProjet, setCeProjet] = useState(false);
	const projetDisponible = nav.projetPremierPlan;
	const projet = ceProjet && projetUtilisable(filtre) ? projetDisponible : null;
	const moteur = useRechercheMoteur(q, { ...demandeAuMoteur(filtre, projet), actif: filtre !== 'sessions' });
	// réponse complète sans aucune note : les modèles ne tournaient pas (la recherche les relance en arrière-plan pour la
	// suivante), ils chargent, ou le niveau les exclut ; l'avis dit lequel
	const sansNotes = moteur.complet && (moteur.trouves?.length ?? 0) > 0 && moteur.trouves!.every((t) => t.note === null);
	const modeles = useModeles(sansNotes);
	// la palette n'a pas de session : le niveau de la machine seul
	const avis = sansNotes ? avisModeles(modeles.etat, null) : null;
	const [demarrage, setDemarrage] = useState<'demarres' | 'echec' | null>(null);
	const [choisie, setChoisie] = useState<string | null>(null);
	const champ = useRef<HTMLInputElement>(null);
	const ouverte = useRef(false);
	const surOuverture = useRef(p.surOuverture);
	surOuverture.current = p.surOuverture;
	const rect = useRectAncre(p.ancre);
	const position = rect === null ? null : positionMenu(rect, window.innerWidth);

	const recherche = JSON.stringify([q, filtre, projet]);
	const { tout, toutVoir } = useToutPour(recherche);
	const { resultats, enPlus } = useMemo(
		() => resultatsPalette({ q, sessions: connues, fiches: graphe.donnees?.fiches ?? [], moteur: moteur.trouves, filtre, projet, tout }),
		[q, connues, graphe.donnees, moteur.trouves, filtre, projet, tout],
	);
	const mots = useMemo(() => motsDe(q), [q]);
	// la sélection suit l'élément choisi tant qu'il reste dans la liste (provisoire remplacé par le moteur, appel complet)
	const courant = Math.max(0, resultats.findIndex((r) => r.cle === choisie));

	// Focus dans le champ à l'ouverture ; rendu à l'élément d'avant à la fermeture, sauf si un résultat a été ouvert.
	useEffect(() => {
		const actif = document.activeElement;
		const avant = actif instanceof HTMLElement && actif !== document.body ? actif : null;
		champ.current?.focus();
		surOuverture.current();
		return () => {
			if (!ouverte.current && avant?.isConnected) avant.focus({ preventScroll: true });
		};
	}, []);

	useEffect(() => {
		document.getElementById(`palette-${courant}`)?.scrollIntoView?.({ block: 'nearest' });
	}, [courant]);

	/** Piège du focus : Tab et Maj+Tab tournent parmi les éléments focalisables de la palette. */
	function garderLeFocus(e: KeyboardEvent<HTMLDivElement>): void {
		if (e.key !== 'Tab') return;
		e.preventDefault();
		const elements = [...e.currentTarget.querySelectorAll<HTMLElement>('input, button, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'));
		if (!elements.length) return;
		const i = elements.indexOf(document.activeElement as HTMLElement);
		const suivant = e.shiftKey ? (i <= 0 ? elements.length - 1 : i - 1) : (i + 1) % elements.length;
		elements[suivant]!.focus();
	}

	function choisirFiltre(f: Filtre): void {
		setFiltre(f);
		setChoisie(null);
	}

	/** ←/→ entre les filtres : le focus passe au voisin, choisi à son tour s'il est un filtre exclusif. */
	function parcourirFiltres(e: KeyboardEvent<HTMLDivElement>): void {
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
		e.preventDefault();
		const boutons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')].filter((b) => !b.disabled);
		const i = boutons.indexOf(document.activeElement as HTMLButtonElement);
		const suivant = boutons[(i + (e.key === 'ArrowRight' ? 1 : -1) + boutons.length) % boutons.length]!;
		suivant.focus();
		const valeur = suivant.dataset['filtre'] as Filtre | undefined;
		if (valeur) choisirFiltre(valeur);
	}

	function ouvrir(r: Resultat | undefined): void {
		if (!r) return;
		ouverte.current = true;
		nav.ouvrirPalette(false);
		if (r.genre === 'session') ouvrirSession(r.session.id, { zoom: true });
		else nav.ouvrirFiche(r.genre === 'provisoire' ? r.fiche.chemin : r.trouve.chemin);
	}

	const texte = q.trim();
	const rien = texte !== '' && resultats.length === 0;
	return (
		<>
			<div className={s.fond} onMouseDown={() => nav.ouvrirPalette(false)} aria-hidden="true" />
			<div className={s.palette} role="dialog" aria-modal="true" aria-label={t.nom} onKeyDown={garderLeFocus}>
				<div className={s.cadreChamp} data-champ-palette="" style={position ? px(position.champ) : undefined}>
					<input
						ref={champ}
						className={s.champ}
						type="text"
						role="combobox"
						aria-label={t.champ}
						aria-expanded={resultats.length > 0}
						aria-controls="palette-resultats"
						aria-activedescendant={resultats.length ? `palette-${courant}` : undefined}
						aria-autocomplete="list"
						placeholder={textes.coquille.barreTitre.chercher}
						value={q}
						onChange={(e) => {
							setQ(e.target.value);
							setChoisie(null);
						}}
						onKeyDown={(e) => {
							if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
								e.preventDefault();
								if (!resultats.length) return;
								const pas = e.key === 'ArrowDown' ? 1 : -1;
								setChoisie(resultats[(courant + pas + resultats.length) % resultats.length]!.cle);
							} else if (e.key === 'Enter') {
								e.preventDefault();
								ouvrir(resultats[courant]);
							}
						}}
					/>
				</div>
				<div className={s.menu} data-menu-palette="" style={position ? px(position.menu) : undefined}>
					<div className={s.filtres} role="group" aria-label={t.filtresNom} onKeyDown={parcourirFiltres}>
						{FILTRES.map((f) => (
							<button key={f} type="button" className={s.filtre} data-filtre={f} aria-pressed={filtre === f} onClick={() => choisirFiltre(f)}>
								{t.filtres[f]}
							</button>
						))}
						{projetDisponible && (
							<button
								type="button"
								className={cx(s.filtre, s.projet)}
								aria-pressed={ceProjet && projetUtilisable(filtre)}
								disabled={!projetUtilisable(filtre)}
								title={projetUtilisable(filtre) ? `${projetDisponible.projet} : ${projetDisponible.position}` : t.ceProjetSansObjet}
								onClick={() => {
									setCeProjet((c) => !c);
									setChoisie(null);
								}}
							>
								<span>{t.ceProjet}</span>
								<span className={s.nomProjet}>{projetDisponible.projet}</span>
							</button>
						)}
					</div>
					<ul className={s.liste} role="listbox" id="palette-resultats" aria-label={t.resultats}>
						{resultats.map((r, i) => (
							<li
								key={r.cle}
								id={`palette-${i}`}
								role="option"
								aria-selected={i === courant}
								className={cx(s.option, i === courant && s.on)}
								onMouseMove={() => i !== courant && setChoisie(r.cle)}
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => ouvrir(r)}
							>
								<Ligne r={r} mots={mots} t={t} racine={racine} />
							</li>
						))}
					</ul>
					<DePlus nombre={enPlus} surToutVoir={toutVoir} />
					{rien && moteur.enCours && <p className={s.etat}>{t.recherche}</p>}
					{rien && !moteur.enCours && !moteur.erreur && <p className={s.etat}>{t.rien(texte)}</p>}
					{moteur.erreur && <p className={s.etat}>{t.indisponible(moteur.erreur)}</p>}
					{sansNotes &&
						(demarrage === 'demarres' ? (
							<p className={s.modeles}>{t.modeles.demarres}</p>
						) : avis?.motif === 'arretes' ? (
							<p className={s.modeles}>
								{t.modeles.arretes}
								<button
									type="button"
									className={s.demarrer}
									onClick={() =>
										void modeles.demarrer().then(
											() => setDemarrage('demarres'),
											() => setDemarrage('echec'),
										)
									}
								>
									{t.modeles.demarrer}
								</button>
								{demarrage === 'echec' && t.modeles.echec}
							</p>
						) : avis?.motif === 'absents' ? (
							<p className={s.modeles}>{t.modeles.absents}</p>
						) : avis?.motif === 'chargement' ? (
							<p className={s.modeles}>{t.modeles.chargement}</p>
						) : avis?.motif === 'coupes' ? (
							<p className={s.modeles}>{t.modeles.coupes}</p>
						) : avis?.motif === 'sens' ? (
							<p className={s.modeles}>{t.modeles.sens}</p>
						) : null)}
				</div>
			</div>
		</>
	);
}

const px = (o: Record<string, number>): CSSProperties => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, `${v}px`]));

type TextesPalette = Textes['coquille']['palette'];

function Ligne(p: { r: Resultat; mots: readonly string[]; t: TextesPalette; racine: string }): ReactNode {
	const r = p.r;
	const g = p.t.genres;
	if (r.genre === 'trouve') return <LigneTrouve t={r.trouve} rattaches={r.rattaches} mots={p.mots} textes={p.t} racine={p.racine} />;
	if (r.genre === 'session') {
		const x = r.session;
		const archiviste = x.profil === PROFIL_ARCHIVISTE;
		return (
			<>
				<span className={s.note} />
				<Icone genre={archiviste ? 'archiviste' : 'session'} libelle={archiviste ? g.archiviste : g.session} />
				<span className={s.texte}>
					<span className={s.ligne1}>
						<Point etat={x.etat} petit />
						<span className={s.titre}>
							<Segments segments={surligner(x.objectif ?? p.t.session(x.id.slice(0, 4)), p.mots)} />
						</span>
					</span>
					<span className={s.ligne2}>
						<span className={s.chemin}>{x.dossier || p.racine}</span>
					</span>
				</span>
			</>
		);
	}
	const f = r.fiche;
	const document = estDocument(f.type);
	return (
		<>
			<span className={s.note} />
			<Icone genre={document ? 'document' : 'fiche'} libelle={document ? g.document : g.fiche} />
			<span className={s.texte}>
				<span className={s.ligne1}>
					<span className={s.titre}>
						<Segments segments={surligner(f.titre, p.mots)} />
					</span>
				</span>
				<span className={s.ligne2}>
					<span className={s.chemin}>{cheminCourt(f.chemin, p.racine)}</span>
				</span>
			</span>
		</>
	);
}

function LigneTrouve(p: { t: TrouveRechercheVue; rattaches: readonly TrouveRechercheVue[]; mots: readonly string[]; textes: TextesPalette; racine: string }): ReactNode {
	const t = p.t;
	const note = pourcentage(t.note);
	const morceaux = extrait(corpsDe(t), p.mots);
	return (
		<>
			<span className={s.note} title={note === null ? undefined : p.textes.noteReranker}>
				{note}
			</span>
			<Icone genre={iconeDe(t)} libelle={libelleGenre(t, p.textes.genres)} />
			<span className={s.texte}>
				<span className={s.ligne1}>
					<span className={s.titre}>
						<Segments segments={surligner(titreDe(t), p.mots)} />
					</span>
				</span>
				<span className={s.ligne2}>
					<span className={s.chemin}>
						{cheminCourt(t.chemin, p.racine)}
						{t.page != null && p.textes.page(t.page)}
					</span>
					{morceaux.length > 0 && (
						<span className={s.extrait}>
							<Segments segments={morceaux} />
						</span>
					)}
				</span>
				{p.rattaches.map((x) => (
					<SousLigne key={x.id} t={x} mots={p.mots} textes={p.textes} />
				))}
			</span>
		</>
	);
}

/** Un autre élément de la même fiche (information, passage…), sous elle : son genre, sa note, son extrait. */
function SousLigne(p: { t: TrouveRechercheVue; mots: readonly string[]; textes: TextesPalette }): ReactNode {
	const note = pourcentage(p.t.note);
	return (
		<span className={s.sousLigne}>
			<Icone genre={iconeDe(p.t)} libelle={libelleGenre(p.t, p.textes.genres)} />
			<span className={s.extrait}>
				<Segments segments={extrait(corpsDe(p.t), p.mots)} />
			</span>
			{note !== null && (
				<span className={s.noteSous} title={p.textes.noteReranker}>
					{note}
				</span>
			)}
		</span>
	);
}

/** Texte découpé, les mots cherchés en `<mark>` : des éléments React, jamais du HTML. */
function Segments(p: { segments: readonly Segment[] }): ReactNode {
	return p.segments.map((x, i) => (x.surligne ? <mark key={i}>{x.texte}</mark> : <span key={i}>{x.texte}</span>));
}

type GenreIcone = 'session' | 'archiviste' | 'fiche' | 'document' | 'fait' | 'consigne' | 'passage';

function iconeDe(t: TrouveRechercheVue): GenreIcone {
	if (estDocument(t.typeFiche)) return t.genre === 'fiche' ? 'document' : 'passage';
	return t.genre;
}

const TRACES: Record<GenreIcone, string> = {
	session: 'M2 3h12v10H2z M4.5 6.5l2 1.5-2 1.5 M8 10h3.5',
	archiviste: 'M2 3h12v3H2z M3 6v7h10V6 M6.5 9h3',
	fiche: 'M4 1.5h5l3 3v10H4z M9 1.5v3h3',
	document: 'M4 1.5h5l3 3v10H4z M9 1.5v3h3 M6 8h4 M6 10.5h4',
	fait: 'M3 4h1 M6 4h7 M3 8h1 M6 8h7 M3 12h1 M6 12h5',
	consigne: 'M4 14.5V2h7.5l-1.5 3 1.5 3H4',
	passage: 'M3 4h10 M3 7h10 M3 10h10 M3 13h6',
};

/** Icône du genre (dessin seul) ; le libellé est lu par les lecteurs d'écran et donné en bulle. */
function Icone(p: { genre: GenreIcone; libelle: string }): ReactNode {
	return (
		<span className={s.genre} role="img" aria-label={p.libelle} title={p.libelle}>
			<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
				<path d={TRACES[p.genre]} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		</span>
	);
}
