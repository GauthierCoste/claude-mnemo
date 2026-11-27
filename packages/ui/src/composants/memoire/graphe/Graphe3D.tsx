/**
 * Mémoire › Graph 3D : pilote la scène three.js (lecture, filtres, recherche, voisinage, épingles, densité des
 * étiquettes), avec ses panneaux `.ov`. Chargé à part (React.lazy) avec three.js.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useGraphe, useRecherche } from '../../../client/hooks.ts';
import { surChangementAccent } from '../../../reglages/accent.ts';
import { lireCouleursGraphe, type CouleursGraphe } from '../../../graphe/couleurs.ts';
import { cibler, creerSimulation, placerAuDepart, type Disposition } from '../../../graphe/disposition.ts';
import {
	cleDuNoeud,
	construireLegende,
	correspondAuxFiltres,
	cranDeDensite,
	nomDeRelation,
	dansLaBranche,
	DENSITES_ETIQUETTES,
	filtrerParTitre,
	filtresActifs,
	liensDesTypes,
	lienVisible,
	preparerGraphe,
	retenueParLesChoix,
	tailleDuNoeud,
	TYPES_DE_LIEN,
	voisinage,
	voisinsDirects,
	type Choix,
	type GraphePrepare,
	type LienNoeud,
	type ModeCouleur,
	type ModeTaille,
	type Noeud,
	type TypeDeLien,
} from '../../../graphe/donnees.ts';
import { brancheContenant, brancheDeDepart, depasseLePlafond, PLAFOND_FICHES } from '../../../graphe/plafond.ts';
import { creerSceneGraphe, type SceneGraphe } from '../../../graphe/scene.ts';
import { useTextes } from '../../../langue/langue.tsx';
import type { Textes } from '../../../langue/textes.ts';
import { useSurAction } from '../../../navigation.tsx';
import { origineDeLaTouche } from '../../../raccourcis.ts';
import { useNavigationMemoire } from '../navigation-memoire.tsx';
import { CarteNoeud } from './CarteNoeud.tsx';
import s from './Graphe3D.module.css';
import { LegendeGraphe } from './LegendeGraphe.tsx';
import { PilotageGraphe } from './PilotageGraphe.tsx';
import type { FiltresRecherche, Recherche } from './RechercheGraphe.tsx';

export const CLE_DENSITE = 'mnemo.graphe.densite';
/** Attente de la recherche par mots après la dernière frappe. */
export const DELAI_RECHERCHE_MS = 300;

function lireDensite(): number {
	try {
		return cranDeDensite(window.localStorage.getItem(CLE_DENSITE));
	} catch {
		// Stockage refusé : densité par défaut.
		return cranDeDensite(null);
	}
}

function mouvementReduit(): boolean {
	return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Une touche du graphe ne vaut ni dans un champ ni dans un terminal, ni avec ⌘, Ctrl ou ⌥ (⇧ reste permis : `/`). */
function toucheLibre(e: KeyboardEvent): boolean {
	return !e.metaKey && !e.ctrlKey && !e.altKey && origineDeLaTouche(e.target) === 'page';
}

const AUCUN_FILTRE: FiltresRecherche = { etat: '', categorie: '', liens: '' };

export function Graphe3D(p: { visible: boolean }): ReactNode {
	const t = useTextes().memoire.graphe;
	// lu par la bulle des liens, posée une fois avec la scène
	const textesCourants = useRef(t);
	textesCourants.current = t;
	const memoire = useNavigationMemoire();
	const donnees = useGraphe();
	const vue = useRef<HTMLDivElement>(null);
	const calque = useRef<HTMLDivElement>(null);
	const bulle = useRef<HTMLParagraphElement>(null);
	const saisie = useRef<HTMLInputElement>(null);

	const [scene, setScene] = useState<SceneGraphe | null>(null);
	/** `webgl` : WebGL absent (le message suit la langue) ; sinon le message d'un jeton de couleur illisible. */
	const [panne, setPanne] = useState<'webgl' | { message: string } | null>(null);
	const [couleurs, setCouleurs] = useState<CouleursGraphe | null>(null);
	const [graphe, setGraphe] = useState<GraphePrepare | null>(null);

	const [disposition, setDisposition] = useState<Disposition>('forces');
	const [modeCouleur, setModeCouleur] = useState<ModeCouleur>('branche');
	const [modeTaille, setModeTaille] = useState<ModeTaille>('relations');
	const [branche, setBranche] = useState('');
	const [typesCoches, setTypesCoches] = useState<Set<TypeDeLien>>(() => new Set(TYPES_DE_LIEN));
	const [liensCasses, setLiensCasses] = useState(false);
	const [rotation, setRotation] = useState(false);
	const [densite, setDensite] = useState(lireDensite);
	const [profondeur, setProfondeur] = useState(1);
	const [legendesChoisies, setLegendesChoisies] = useState<Set<string>>(() => new Set());
	const [relationsMasquees, setRelationsMasquees] = useState<Set<string | null>>(() => new Set());
	const [selection, setSelection] = useState<Noeud | null>(null);
	const [survol, setSurvol] = useState<Noeud | null>(null);
	const [epingles, setEpingles] = useState(0);
	const [texte, setTexte] = useState('');
	const [filtres, setFiltres] = useState<FiltresRecherche>(AUCUN_FILTRE);

	const choix: Choix = useMemo(() => ({ legende: legendesChoisies, notions: new Set<string>() }), [legendesChoisies]);

	// --- Scène : créée une fois ; couleurs lues dans les jetons ; WebGL absent → message, le reste de l'interface intact ---
	const rappels = useRef({
		survol: (_: Noeud | null) => {},
		clic: (_: Noeud | null) => {},
		doubleClic: (_: Noeud) => {},
	});
	useEffect(() => {
		let lues: CouleursGraphe;
		try {
			lues = lireCouleursGraphe(getComputedStyle(document.documentElement));
		} catch (erreur) {
			setPanne({ message: erreur instanceof Error ? erreur.message : String(erreur) });
			return;
		}
		let creee: SceneGraphe;
		try {
			creee = creerSceneGraphe({
				conteneur: vue.current!,
				calqueEtiquettes: calque.current!,
				couleurs: lues,
				mouvementReduit,
				rappels: {
					survol: (n) => rappels.current.survol(n),
					lienSurvole: (lien, x, y) => montrerLien(bulle.current, lien, x, y, textesCourants.current),
					clic: (n) => rappels.current.clic(n),
					doubleClic: (n) => rappels.current.doubleClic(n),
					epingles: setEpingles,
				},
			});
		} catch {
			setPanne('webgl');
			return;
		}
		setPanne(null);
		setCouleurs(lues);
		setScene(creee);
		return () => {
			creee.detruire();
			setScene(null);
		};
	}, []);

	// La couleur principale change (Réglages) : les jetons sont relus, la scène garde ses positions.
	useEffect(() => {
		if (!scene) return;
		return surChangementAccent(document.documentElement, () => {
			try {
				scene.majCouleurs(lireCouleursGraphe(getComputedStyle(document.documentElement)));
			} catch {
				// jeton illisible : les couleurs précédentes restent
			}
		});
	}, [scene]);

	// --- Données reçues (et chaque message `memoire`) : positions, épingles et sélection gardées par clé ---
	// Seules des données fraîches sont lues, une fois chacune : à l'ouverture, la copie du cache puis sa relecture
	// feraient deux chargements, et le second annulerait le recadrage du premier.
	const precedent = useRef<GraphePrepare | null>(null);
	const donneesLues = useRef<{ scene: SceneGraphe; donnees: unknown } | null>(null);
	useEffect(() => {
		if (!scene || !couleurs || !donnees.donnees || donnees.chargement) return;
		if (donneesLues.current?.scene === scene && donneesLues.current.donnees === donnees.donnees) return;
		donneesLues.current = { scene, donnees: donnees.donnees };
		const anciennes = new Map((precedent.current?.noeuds ?? []).map((noeud) => [cleDuNoeud(noeud), noeud]));
		const nouveau = preparerGraphe(donnees.donnees, couleurs);
		placerAuDepart(nouveau.noeuds);
		for (const noeud of nouveau.noeuds) {
			const ancien = anciennes.get(cleDuNoeud(noeud));
			if (ancien) Object.assign(noeud, { x: ancien.x, y: ancien.y, z: ancien.z, epingle: ancien.epingle === true });
		}
		precedent.current = nouveau;
		scene.charger(nouveau);
		const grande = nouveau.compteurs.fiches > PLAFOND_FICHES;
		setBranche((b) => {
			const existe = nouveau.branches.some(([nom]) => nom === b);
			if (grande) return existe && b !== '' ? b : brancheDeDepart(nouveau.branches, nouveau.compteurs.fiches);
			return existe ? b : '';
		});
		setSelection((choisi) => (choisi ? (nouveau.noeuds.find((noeud) => cleDuNoeud(noeud) === cleDuNoeud(choisi)) ?? null) : null));
		setSurvol(null);
		setEpingles(nouveau.noeuds.filter((noeud) => noeud.epingle).length);
		setGraphe(nouveau);
	}, [scene, couleurs, donnees.donnees, donnees.chargement]);

	const grande = graphe ? graphe.compteurs.fiches > PLAFOND_FICHES : false;

	// --- Lecture : légende, tailles, visibilité ---
	const lecture = useMemo(() => {
		if (!graphe) return null;
		const parLesNotions: Choix = { legende: new Set(), notions: choix.notions };
		const legende = construireLegende(
			graphe.noeuds,
			modeCouleur,
			Date.now(),
			graphe.couleurs,
			(noeud) => dansLaBranche(noeud, branche) && retenueParLesChoix(noeud, parLesNotions),
			t,
		);
		for (const noeud of graphe.noeuds) {
			if (noeud.notion) continue;
			noeud.taille = tailleDuNoeud(noeud, modeTaille);
			noeud.visible = noeud.fantome
				? liensCasses && (branche === '' || noeud.entrants.some((lien) => dansLaBranche(lien.source, branche)))
				: retenueParLesChoix(noeud, choix) && dansLaBranche(noeud, branche);
		}
		for (const notion of graphe.notions) {
			notion.taille = tailleDuNoeud(notion, modeTaille);
			notion.visible = false;
		}
		// Un seul parcours : les liens suivis sont ceux des types cochés, quel que soit leur type ; la scène les dessine par type.
		const liensSuivis = liensDesTypes(graphe, typesCoches).filter((lien) => lienVisible(lien, relationsMasquees));
		const liensVisibles = liensSuivis.filter((lien) => lien.type === 'personnalise');
		const parentesVisibles = liensSuivis.filter((lien) => lien.type === 'parente');
		return { legende, liensSuivis, liensVisibles, parentesVisibles };
	}, [graphe, modeCouleur, modeTaille, branche, liensCasses, typesCoches, choix, relationsMasquees, t]);

	// « Relié à » : les liens des types cochés, filtres et branche mis à part (une fiche d'une autre branche y reste).
	const relies = useMemo(() => (graphe && selection ? voisinsDirects(selection, liensDesTypes(graphe, typesCoches)) : []), [graphe, selection, typesCoches]);

	// Une sélection devenue invisible est fermée.
	useEffect(() => {
		if (lecture && selection && !selection.visible) setSelection(null);
	}, [lecture, selection]);

	// --- Recherche : titres et alias sur place, puis la recherche du service (faits) ---
	const texteCherche = texte.trim();
	const parMotsDuService = useRecherche(texteCherche.length >= 2 ? texteCherche : '', DELAI_RECHERCHE_MS);
	const recherche: Recherche | null = useMemo(() => {
		if (!graphe || !lecture) return null;
		// La branche compte parmi les filtres.
		const tous = { ...filtres, branche };
		const nombreFiltres = filtresActifs(tous);
		if (texteCherche === '' && nombreFiltres === 0) return null;
		const retenus = (noeud: Noeud) => correspondAuxFiltres(noeud, tous) && retenueParLesChoix(noeud, choix);
		const parTitre =
			texteCherche === '' ? graphe.noeuds.filter(retenus).sort((a, b) => a.titre.localeCompare(b.titre)) : filtrerParTitre(graphe.noeuds, texteCherche).filter(retenus);
		const parChemin = new Map(graphe.noeuds.filter((noeud) => noeud.chemin).map((noeud) => [noeud.chemin!, noeud]));
		const parMots = texteCherche.length >= 2 ? (parMotsDuService.donnees ?? []).flatMap((trouve) => {
			const noeud = parChemin.get(trouve.chemin);
			return noeud && retenus(noeud) ? [{ trouve, noeud }] : [];
		}) : [];
		const ordre = [...parTitre];
		for (const { noeud } of parMots) if (!ordre.includes(noeud)) ordre.push(noeud);
		return {
			ensemble: new Set(ordre),
			ordre,
			parTitre,
			parMots,
			enCours: texteCherche.length >= 2 && parMotsDuService.chargement,
			erreur: texteCherche.length >= 2 ? parMotsDuService.erreur : null,
		};
	}, [graphe, lecture, texteCherche, filtres, branche, choix, parMotsDuService.donnees, parMotsDuService.chargement, parMotsDuService.erreur]);

	// --- Mise en avant : sélection (et son voisinage), recherche, survol ---
	// Le survol ne réapplique la scène que sans sélection ; il est lu au moment d'appliquer.
	const survolCourant = useRef<Noeud | null>(null);
	survolCourant.current = survol;
	const survolDeclencheur = selection ? null : survol;
	useEffect(() => {
		const survol = survolCourant.current;
		if (!scene || !graphe || !lecture) return;
		const { liensSuivis, liensVisibles, parentesVisibles } = lecture;
		let focus: Set<Noeud> | null = null;
		let ordre: Noeud[];
		const parTaille = (a: Noeud, b: Noeud) => b.taille - a.taille;
		if (selection) {
			focus = voisinage(selection, profondeur, liensSuivis);
			ordre = [...focus].sort(parTaille);
		} else if (recherche) {
			focus = recherche.ensemble;
			ordre = recherche.ordre;
		} else if (survol) {
			focus = voisinage(survol, 1, liensSuivis);
			ordre = [...focus].sort(parTaille);
		} else {
			ordre = graphe.noeuds.filter((noeud) => noeud.visible && !noeud.fantome).sort(parTaille);
		}
		scene.appliquer({ focus, selection, survol, ordre, liensVisibles, parentesVisibles, notionsVisibles: [] });
	}, [scene, graphe, lecture, selection, survolDeclencheur, recherche, profondeur]);

	// --- Disposition : à la première lecture, au changement de disposition ou de branche (grande mémoire) ---
	const brancheSimulee = grande ? branche : '';
	const dernierGraphe = useRef<GraphePrepare | null>(null);
	useEffect(() => {
		if (!scene || !graphe) return;
		// Relecture de la mémoire : la figure repart des positions gardées, sans recadrer.
		const relecture = dernierGraphe.current !== null && dernierGraphe.current !== graphe;
		dernierGraphe.current = graphe;
		// Grande mémoire : seule la branche affichée est disposée (la répulsion est en n²).
		const simules = graphe.noeuds.filter((noeud) =>
			noeud.notion ? false : noeud.fantome ? noeud.entrants.some((lien) => dansLaBranche(lien.source, brancheSimulee)) : dansLaBranche(noeud, brancheSimulee),
		);
		const dans = new Set(simules);
		const liens = [...graphe.liens, ...graphe.parentes].filter((lien) => dans.has(lien.source) && dans.has(lien.cible));
		const racines = [...new Set(simules.filter((noeud) => !noeud.fantome).map((noeud) => noeud.racine))].sort();
		const axe = cibler(simules, disposition, { racines, notions: graphe.notions.map((notion) => notion.notionId!), textes: t.axe });
		scene.disposer(creerSimulation(simules, liens, disposition), axe, !relecture || disposition === 'temps');
	}, [scene, graphe, disposition, brancheSimulee, t]);

	// --- Densité, rotation (coupée quand l'onglet est caché) ---
	useEffect(() => {
		const { maximum, chevauchements } = DENSITES_ETIQUETTES[densite]!;
		scene?.densiteEtiquettes({ maximum, chevauchements });
		try {
			window.localStorage.setItem(CLE_DENSITE, String(densite));
		} catch {
			// Stockage refusé : le cran vaut pour cette visite seulement.
		}
	}, [scene, densite]);
	useEffect(() => {
		scene?.rotation(rotation && p.visible);
	}, [scene, rotation, p.visible]);

	// --- Actions ---
	const selectionner = useCallback(
		(noeud: Noeud | null, voler: boolean) => {
			setSelection(noeud);
			setSurvol(null);
			if (noeud && voler) scene?.centrerSur(noeud);
		},
		[scene],
	);

	/** Une fiche ouverte depuis un lien doit se voir : les choix qui l'écartent sont retirés. */
	const montrerFiche = useCallback(
		(noeud: Noeud) => {
			if (!noeud.fantome && !noeud.notion && !retenueParLesChoix(noeud, choix)) setLegendesChoisies(new Set());
			// En grande mémoire, la fiche hors de la branche affichée ouvre la branche qui la
			// contient sous le plafond (une fiche à la racine garde la branche affichée).
			if (grande && graphe && !noeud.fantome && !noeud.notion && !dansLaBranche(noeud, branche)) setBranche(brancheContenant(graphe.branches, noeud.branche, branche));
		},
		[choix, branche, grande, graphe],
	);

	const ouvrir = useCallback(
		(noeud: Noeud) => {
			if (noeud.chemin && !noeud.fantome && !noeud.notion) memoire.ouvrirFiche(noeud.chemin);
			else selectionner(noeud, true);
		},
		[memoire, selectionner],
	);

	rappels.current = {
		survol: (noeud) => setSurvol(noeud),
		clic: (noeud) => selectionner(noeud, false),
		doubleClic: ouvrir,
	};

	const changerDisposition = (nouvelle: Disposition) => {
		scene?.libererEpingles(false);
		setEpingles(0);
		setDisposition(nouvelle);
	};

	const effacerRecherche = () => {
		setTexte('');
		setFiltres(AUCUN_FILTRE);
	};

	const basculer = <T,>(ensemble: Set<T>, cle: T): Set<T> => {
		const suivant = new Set(ensemble);
		if (suivant.has(cle)) suivant.delete(cle);
		else suivant.add(cle);
		return suivant;
	};

	// « Voir dans le graphe » : centrage demandé depuis Fichiers, servi dès que le graphe est prêt.
	const centrageServi = useRef(0);
	useEffect(() => {
		const demande = memoire.centrage;
		if (!demande || demande.numero === centrageServi.current || !graphe || !lecture) return;
		const noeud = graphe.noeuds.find((n) => n.chemin === demande.chemin);
		if (!noeud) return;
		centrageServi.current = demande.numero;
		montrerFiche(noeud);
		selectionner(noeud, true);
	}, [memoire.centrage, graphe, lecture, montrerFiche, selectionner]);

	// --- Clavier : / recherche, L densité suivante, R recadrer, Échap ferme la fiche ou efface la recherche ---
	useEffect(() => {
		if (!p.visible) return;
		const surTouche = (e: KeyboardEvent) => {
			if (!toucheLibre(e)) return;
			if (e.key === '/') {
				e.preventDefault();
				saisie.current?.focus();
				saisie.current?.select();
			} else if (e.code === 'KeyL') {
				e.preventDefault();
				setDensite((cran) => (cran + 1) % DENSITES_ETIQUETTES.length);
			} else if (e.code === 'KeyR') {
				e.preventDefault();
				scene?.recadrer();
			}
		};
		document.addEventListener('keydown', surTouche);
		return () => document.removeEventListener('keydown', surTouche);
	}, [p.visible, scene]);
	useSurAction((action) => {
		if (action.genre !== 'echap' || !p.visible) return;
		if (selection) selectionner(null, false);
		else effacerRecherche();
	});

	const nombreDeFiches = graphe?.compteurs.fiches ?? 0;
	const avis = grande ? t.grandeMemoire(nombreDeFiches, graphe !== null && depasseLePlafond(graphe.branches, branche)) : null;
	const message =
		panne === 'webgl'
			? t.webgl
			: panne !== null
				? panne.message
				: graphe
					? nombreDeFiches === 0
						? t.vide
						: null
					: donnees.erreur
						? t.illisible(donnees.erreur)
						: t.lecture;

	return (
		<div className={s.graphe}>
			<div className={s.vue} ref={vue}>
				<div className={s.etiquettes} ref={calque} aria-hidden="true" />
				<p className={s.bulle} ref={bulle} hidden />
			</div>
			{message && (
				// à gauche ; à droite du panneau de pilotage quand il est affiché (mémoire vide)
				<p className={!panne && graphe && lecture ? `${s.message} ${s.apresPilotage}` : s.message} role="status">
					{message}
				</p>
			)}
			{!panne && graphe && lecture && (
				<>
					<PilotageGraphe
						graphe={graphe}
						avis={avis}
						grande={grande}
						recherche={recherche}
						texte={texte}
						filtres={filtres}
						saisie={saisie}
						surTexte={setTexte}
						surFiltres={setFiltres}
						surEffacer={effacerRecherche}
						surResultat={(noeud) => selectionner(noeud, true)}
						disposition={disposition}
						surDisposition={changerDisposition}
						modeCouleur={modeCouleur}
						surModeCouleur={(mode) => {
							setLegendesChoisies(new Set());
							setModeCouleur(mode);
						}}
						modeTaille={modeTaille}
						surModeTaille={setModeTaille}
						branche={branche}
						surBranche={setBranche}
						relationsMasquees={relationsMasquees}
						surRelation={(relation) => setRelationsMasquees((m) => basculer(m, relation))}
						liensCasses={liensCasses}
						surLiensCasses={setLiensCasses}
						rotation={rotation}
						surRotation={setRotation}
						densite={densite}
						surDensite={setDensite}
						epingles={epingles}
						surLiberer={() => {
							scene?.libererEpingles();
							setEpingles(0);
						}}
						surRecadrer={() => scene?.recadrer()}
					/>
					<CarteNoeud
						noeud={selection}
						relies={relies}
						profondeur={profondeur}
						surProfondeur={setProfondeur}
						surCentrer={() => selection && scene?.centrerSur(selection)}
						surFermer={() => selectionner(null, false)}
						surOuvrir={ouvrir}
						surChoisir={(noeud) => {
							// Une fiche absente allume les liens cassés.
							if (noeud.fantome) setLiensCasses(true);
							montrerFiche(noeud);
							selectionner(noeud, true);
						}}
					/>
					<LegendeGraphe
						legende={lecture.legende}
						choisies={legendesChoisies}
						surChoix={(cle) => setLegendesChoisies((c) => basculer(c, cle))}
						surToutAfficher={() => setLegendesChoisies(new Set())}
						typesCoches={typesCoches}
						surType={(type) => setTypesCoches((t) => basculer(t, type))}
					/>
				</>
			)}
			<p className={s.aide}>{t.aide}</p>
		</div>
	);
}

/** Bulle d'un lien survolé, écrite directement (elle suit le pointeur à chaque image). */
function montrerLien(bulle: HTMLParagraphElement | null, lien: LienNoeud | null, x: number, y: number, t: Textes['memoire']['graphe']): void {
	if (!bulle) return;
	if (!lien) {
		bulle.hidden = true;
		return;
	}
	const texte = t.bulleLien(lien.source.titre, lien.relation === null ? '' : nomDeRelation(lien.relation, t), lien.cible.titre);
	if (bulle.textContent !== texte) bulle.textContent = texte;
	bulle.style.transform = `translate(${Math.round(x + 12)}px, ${Math.round(y + 12)}px)`;
	bulle.hidden = false;
}
