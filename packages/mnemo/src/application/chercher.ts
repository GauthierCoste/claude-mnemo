import { classer, fusionner } from '../domaine/classement.ts';
import { sigmoide } from '../domaine/contexte-score.ts';
import type { Candidat, Classe } from '../domaine/classement.ts';
import { dossiersAscendants, ficheDeDossier } from '../domaine/chemin.ts';
import { estContenuDeDocument, estExpire } from '../domaine/elements.ts';
import type { ElementIndexe, GenreElement, Lien, StatutElement } from '../domaine/elements.ts';
import { dedoublonner } from '../domaine/dedoublonner.ts';
import type { EntreeADedoublonner } from '../domaine/dedoublonner.ts';
import { noterRecherche } from '../domaine/note-de-recherche.ts';
import type { ApportRecherche, NoteRecherche, PoidsRecherche } from '../domaine/note-de-recherche.ts';
import type { Etendue } from '../domaine/etendue.ts';
import type { TypeFiche } from '../domaine/fiche.ts';
import { estPassageDeSynthese } from '../domaine/passages-fiche.ts';
import { expressionFts } from '../domaine/requete.ts';
import { normaliser, texteAVectoriser } from '../domaine/sens.ts';
import { REGLAGES_PAR_DEFAUT } from '../domaine/reglages.ts';
import type { Regles, TypeSource } from '../domaine/regles.ts';
import { aujourdhui } from './commun.ts';
import { cibleDuLien, confianceDeRecherche, ficheCitee } from './confiance-de-recherche.ts';
import type { Dependances, FiltreIndex, Index, OptionsModele, Sens } from './ports.ts';
import { liensDeLaFiche } from './liens-de-fiche.ts';
import { liensDeLaMemoire } from './liens.ts';
import type { LiensResolus } from './liens.ts';
import { chargerRegles } from './regles-du-coffre.ts';
import { SANS_EXTRACTION, synchroniser } from './synchroniser.ts';
import type { BilanSynchro } from './synchroniser.ts';
import { vectoriser } from './vectoriser.ts';

/** Étapes de la chaîne de recherche (au-delà des mots, toujours là) ; le banc les coupe une à une. */
export type Variante = { sens: boolean; reranker: boolean; graphe: boolean; position: boolean };
export const VARIANTE_COMPLETE: Variante = { sens: true, reranker: true, graphe: true, position: true };

/**
 * Modèles permis à une recherche (`null` : étape sautée). `fin` : échéance unique de l'appel (`Date.now()`), partagée par
 * toutes les étapes. `demarrer` : sans serveur en marche, en lancer un (sinon l'étape saute). `similariteMin` : cosinus
 * minimal d'un voisin de la liste « sens ». Absentes : les mots seuls.
 */
export type OptionsRecherche = {
	fin: number;
	sens: { demarrer: boolean; similariteMin: number } | null;
	reranker: { demarrer: boolean } | null;
	/** Budget maximal de la vectorisation de la requête ; 2 s par défaut (le banc, qui mesure la qualité, en donne plus). */
	sensMaxMs?: number;
	/**
	 * Cache de vecteurs froid : `permis` (défaut ; le service, dont le cache reste chaud, les outils) ; `si-budget` (hook
	 * local) : le sens est sauté si le premier parcours des vecteurs (`COUT_FROID_MS_PAR_VECTEUR` chacun) ne tient pas dans le
	 * reste du budget moins `MARGE_HOOK_MS`.
	 */
	froid?: 'permis' | 'si-budget';
	/**
	 * Abandon (requête HTTP fermée, recherche remplacée) : vérifié avant chaque étape coûteuse (vectorisation, sens,
	 * reranker), qui est alors sautée et la recherche rejetée avec l'erreur d'abandon.
	 */
	signal?: AbortSignal;
};
const SANS_MODELE: OptionsRecherche = { fin: 0, sens: null, reranker: null };
/** Budget d'un appel d'outil ou de la CLI (hors synchronisation), et d'un hook. */
export const BUDGET_OUTIL_MS = 3500;
export const BUDGET_HOOK_MS = 400;
/** Premier parcours d'un cache de vecteurs froid, par vecteur (mesuré : 225 ms à 50 000 vecteurs, 81 ms ensuite). */
export const COUT_FROID_MS_PAR_VECTEUR = 0.005;
/** Part du budget d'un hook gardée pour le reste de `servir` (graphe, classement, rendu) quand le cache est froid. */
export const MARGE_HOOK_MS = 150;
/** Vectorisation de la requête : au plus 2 s, en laissant 1 s au reranker s'il est permis. */
const SENS_MAX_MS = 2000;
const RESERVE_RERANKER_MS = 1000;
/** Sous ce reste, le reranker n'est pas appelé. */
const RERANKER_MIN_MS = 500;
/** Vecteurs manquants avant une recherche d'outil : au plus 2 s, en laissant 1,5 s à la recherche. */
const VECTORISER_MAX_MS = 2000;
const RESERVE_RECHERCHE_MS = 1500;

/**
 * Reranker des outils et de la CLI : actif. Il fixe l'ordre des 40 premiers sans changer l'échelle de leurs pertinences
 * (`classer`) ; mesuré par le banc (`mnemo banc`) : 30 questions sur 42 dans les 5 premiers au lieu de 27, MRR 0,638 au
 * lieu de 0,529.
 */
export const RERANKER_PAR_DEFAUT = true;

/**
 * Outils et CLI : sens démarré au besoin (reranker selon `RERANKER_PAR_DEFAUT`), 3,5 s pour tout l'appel. `demarrer`
 * faux (interface) : les modèles servent s'ils tournent, ne sont jamais lancés. `similariteMin` : cosinus minimal d'un
 * voisin du sens (réglage `contexte.similariteRecherche`).
 */
export function optionsOutils(debut = Date.now(), demarrer = true, similariteMin = REGLAGES_PAR_DEFAUT.contexte.similariteRecherche): OptionsRecherche {
	return {
		fin: debut + BUDGET_OUTIL_MS,
		sens: { demarrer, similariteMin },
		reranker: RERANKER_PAR_DEFAUT ? { demarrer } : null,
	};
}
export type Requete = {
	texte: string;
	perimetre?: string;
	position?: string;
	inclureInvalides?: boolean;
	inclureAConfirmer?: boolean;
	genres?: GenreElement[];
	/** Types des fiches retenues (ex. `source` : les documents seuls). */
	typesFiche?: TypeFiche[];
	typesFicheExclus?: TypeFiche[];
	/** 10 par défaut. */
	limite?: number;
	/** Ignore le seuil de rappel (proches avant écriture, chronologie) : tout ce qui correspond est rendu. */
	sansSeuil?: boolean;
	/** Étapes actives ; `VARIANTE_COMPLETE` par défaut. */
	variante?: Variante;
	/**
	 * Une entrée par document et par contenu (vrai par défaut) ; faux : toutes les copies sont rendues (proches avant
	 * écriture) ; `meme-date` (chronologie) : un même texte n'est regroupé qu'à date égale.
	 */
	dedoublonner?: boolean | 'meme-date';
};

export type Trouve = {
	id: string;
	chemin: string;
	genre: GenreElement;
	typeFiche: TypeFiche;
	texte: string;
	contexte: string;
	statut: StatutElement;
	date: string | null;
	/** Fait : fin de validité ; un fait expiré reste trouvable (à montrer avec sa date), mais `servir` ne le sert pas. */
	valideFin: string | null;
	/** Vrai si `valideFin` est incluse (`]`). */
	finIncluse: boolean;
	categorie: string | null;
	/** Consigne : `globale`, `genre:nom` ou `invalide` ; sinon null. */
	portee: string | null;
	confiance: number | null;
	source: string | null;
	/**
	 * Type de la source ; null seulement pour un élément sans source hors fiche `source` (tout ce qu'une fiche `source`
	 * contient porte son `type_source`). Tout type hors utilisateur/session/deduction est un document, à encadrer.
	 */
	typeSource: TypeSource | null;
	/** Passage : page du document (PDF) ; null sinon. */
	page?: number | null;
	/**
	 * Note unique (`base` + somme des apports) qui ordonne les résultats : celle du groupe de l'entrée (son mieux classé,
	 * voir `dedoublonner`), qui peut différer de `base` + `apports` quand l'élément montré n'est pas le mieux classé.
	 */
	score: number;
	/** Pertinence fine de l'élément montré pour la requête (mots, sens, graphe, reranker), sans aucun poids. */
	base: number;
	/** Poids qui ont compté pour l'élément montré (position, confiance, mémoire, fraîcheur), dans l'ordre de `noterRecherche`. */
	apports: ApportRecherche[];
	/** Chemins des entrées de même contenu écartées au profit de celle-ci ; absent sans copie. */
	copies?: string[];
	/**
	 * Passage élargi pour être servi (`etendrePassages`) : ce qui est servi (section entière, voisins) ; `regroupes` : les
	 * passages trouvés que l'entrée contient (elle-même comprise). Absent : le texte est celui du passage trouvé.
	 */
	etendue?: Etendue & { regroupes: string[] };
};

const CANDIDATS = 50;
/** Plus proches voisins de la requête demandés à l'index. */
const CANDIDATS_SENS = 50;
/** Fiche renforcée par la liste « graphe » : une fiche de dossier, ou un lieu qui déclare une portée ou un dossier de projet. */
const estLieuDuGraphe = (e: ElementIndexe): boolean => e.typeFiche === 'dossier' || e.portee !== null || e.dossierProjet !== null;


/** Fiche d'une position (chemin relatif à la mémoire) : le chemin d'une fiche, sinon la fiche du dossier ; null à la racine. */
export async function ficheDePosition(dep: Dependances, position: string): Promise<string | null> {
	const nette = position.replace(/\/+$/u, '');
	if (nette === '') return null;
	if (nette.endsWith('.md')) return nette;
	return (await dep.index.element(`${nette}.md`)) !== null ? `${nette}.md` : ficheDeDossier(nette);
}

/** Fiches que la fiche lie (cibles résolues) et celles qui la lient. */
async function lieesA(liens: LiensResolus, chemin: string): Promise<string[]> {
	const sortants = (await liens.sortants(chemin)).flatMap((l) => (l.cible === null ? [] : [l.cible]));
	return [...sortants, ...(await liens.entrants(chemin)).map((l) => l.de)];
}

/** Fiches de la position, de ses dossiers ascendants et celles qu'elles lient ou qui les lient. */
async function voisinage(dep: Dependances, liens: () => Promise<LiensResolus>, position: string | undefined): Promise<Set<string>> {
	const resultat = new Set<string>();
	const fiche = position === undefined ? null : await ficheDePosition(dep, position);
	if (fiche === null) return resultat;
	const fiches = [fiche, ...dossiersAscendants(fiche).map(ficheDeDossier)];
	for (const chemin of fiches) {
		resultat.add(chemin);
		for (const liee of await lieesA(await liens(), chemin)) resultat.add(liee);
	}

	return resultat;
}

/** Vecteur de la requête, ou null (modèle absent, lent, en panne, réponse inutilisable) : jamais d'erreur. */
async function vecteurDeRequete(sens: Sens, texte: string, options: OptionsModele): Promise<Float32Array | null> {
	if (options.budgetMs <= 0) return null;
	try {
		const vecteurs = await sens.vecteurs([texte], options);
		const v = vecteurs?.length === 1 ? vecteurs[0]! : null;
		if (v === null || v.length === 0 || !v.every(Number.isFinite)) return null;
		return normaliser(v);
	} catch {
		return null;
	}
}

/**
 * Liste « sens » : les plus proches voisins de la requête que le filtre retient, d'au moins `similariteMin` ; null si le
 * sens est indisponible ou si aucun voisin n'est assez proche.
 */
async function listeDuSens(dep: Dependances, texte: string, filtre: FiltreIndex, options: OptionsModele, similariteMin: number): Promise<ElementIndexe[] | null> {
	const modele = dep.sens.modele();
	if (modele === null) return null;
	const vecteur = await vecteurDeRequete(dep.sens, texte, options);
	if (vecteur === null) return null;
	const proches = (await dep.index.plusProches(modele, vecteur, filtre, CANDIDATS_SENS)).filter((p) => p.similarite >= similariteMin);
	if (proches.length === 0) return null;
	return dep.index.elementsParId(proches.map((p) => p.id));
}

/**
 * Liste « graphe » : éléments trouvés par les mots (`une`) dans les lieux du graphe (`estLieuDuGraphe`) à un saut (liens
 * sortants et entrants) des premières fiches de la fusion, hors ces fiches elles-mêmes.
 */
async function listeDuGraphe(dep: Dependances, liens: () => Promise<LiensResolus>, fusion: Candidat[], expression: string, filtre: FiltreIndex, limite: number): Promise<ElementIndexe[]> {
	const tete: string[] = [];
	for (const { element } of fusion) {
		if (tete.length >= dep.reglages().recherche.graphe) break;
		if (!tete.includes(element.chemin)) tete.push(element.chemin);
	}
	const lies = new Set<string>();
	for (const chemin of tete) for (const liee of await lieesA(await liens(), chemin)) lies.add(liee);
	// à un saut exactement : une fiche de tête liée à une autre n'est pas renforcée par le graphe
	for (const chemin of tete) lies.delete(chemin);
	// l'élément `fiche` d'une fiche a pour id son chemin
	const chemins = (await dep.index.elementsParId([...lies])).filter(estLieuDuGraphe).map((e) => e.chemin);
	if (chemins.length === 0) return [];
	return dep.index.chercher(expression, { ...filtre, chemins }, limite);
}

/** Notes du reranker (dans [0, 1]) des premiers candidats, par id ; null s'il est indisponible : jamais d'erreur. */
async function notesDuReranker(dep: Dependances, texte: string, fusion: Candidat[], options: OptionsModele): Promise<Map<string, number> | null> {
	const tete = fusion.slice(0, dep.reglages().recherche.reranker).map((c) => c.element);
	if (tete.length === 0) return null;
	try {
		const notes = await dep.reranker.noter(texte, tete.map((e) => texteAVectoriser(e.contexte, e.texte)), options);
		if (notes === null || notes.length !== tete.length) return null;
		const pertinences = new Map<string, number>();
		tete.forEach((e, i) => {
			const note = notes[i]!;
			if (typeof note === 'number' && Number.isFinite(note)) pertinences.set(e.id, sigmoide(note));
		});
		return pertinences.size === tete.length ? pertinences : null;
	} catch {
		return null;
	}
}


/**
 * Vrai si le sens doit être sauté parce que le cache de vecteurs de `modele` est froid et que son premier parcours ne tient
 * pas dans le reste du budget (moins la marge) ; seulement avec `froid: 'si-budget'`.
 */
async function cacheTropFroid(dep: Dependances, modele: string, options: OptionsRecherche): Promise<{ vecteurs: number } | null> {
	if (options.froid !== 'si-budget' || dep.index.cacheVecteurs(modele) === 'chaud') return null;
	const vecteurs = await dep.index.nombreVecteurs(modele);
	return vecteurs * COUT_FROID_MS_PAR_VECTEUR > options.fin - Date.now() - MARGE_HOOK_MS ? { vecteurs } : null;
}

/**
 * Résultat détaillé d'une recherche : `sens` vrai si la liste du sens a compté ; `avis` : pourquoi une étape a sauté
 * (cache de vecteurs froid), sinon null ; `notes` : notes du reranker (dans [0, 1]) par id, null s'il n'a pas tourné.
 */
/**
 * `parLeSens` : ids trouvés par le sens (avant fusion) ; `motsUne` : l'expression plein texte « un des mots » de la recherche
 * (null : aucun mot), pour vérifier ensuite qu'un élément correspond par son texte même (`Index.correspondParLeTexte`).
 */
export type RechercheDetaillee = {
	trouves: Trouve[];
	/** Les `limite` premiers résultats avant le dédoublonnage (le banc compte les doublons qu'il retire). */
	bruts: Trouve[];
	sens: boolean;
	avis: string | null;
	notes: ReadonlyMap<string, number> | null;
	parLeSens: ReadonlySet<string>;
	motsUne: string | null;
};

/**
 * Cherche dans l'index tel qu'il est (pour un appelant qui vient de synchroniser) : mots (`toutes`, puis `une` s'il en
 * manque), sens (50 plus proches), graphe à un saut → fusion par rangs réciproques → reranker sur les 40 premiers →
 * classement → seuil. Un modèle absent, lent ou en panne fait sauter son étape, sans erreur : les mots restent.
 */
export async function chercherSansSynchro(dep: Dependances, requete: Requete, options: OptionsRecherche = SANS_MODELE): Promise<Trouve[]> {
	return (await chercherDetaille(dep, requete, options)).trouves;
}

/** `chercherSansSynchro`, avec l'usage du sens et l'avis d'une étape sautée. */
export async function chercherDetaille(dep: Dependances, requete: Requete, options: OptionsRecherche = SANS_MODELE): Promise<RechercheDetaillee> {
	let avis: string | null = null;
	let avecSens = false;
	const variante = requete.variante ?? VARIANTE_COMPLETE;
	const limite = requete.limite ?? dep.reglages().recherche.resultats;
	const candidats = Math.max(CANDIDATS, limite);
	// Sans aucun mot, rien (pas même par le sens) : un message de politesse ne sert rien.
	const expression = expressionFts(requete.texte, await dep.index.alias());
	if (expression === null) return { trouves: [], bruts: [], sens: false, avis, notes: null, parLeSens: new Set(), motsUne: null };
	// Les statuts dérivés restent trouvables par défaut : un fait dont la source a disparu reste vrai (sa citation est gardée),
	// l'ancienne version d'un document se cherche encore ; chacun est rendu avec son statut.
	const statuts: StatutElement[] = ['servi', 'source_disparue', 'ancienne_version'];
	if (requete.inclureAConfirmer === true) statuts.push('a_confirmer');
	if (requete.inclureInvalides === true) statuts.push('invalide');
	const filtre: FiltreIndex = { statuts };
	if (requete.perimetre !== undefined) filtre.perimetre = requete.perimetre;
	if (requete.genres !== undefined) filtre.genres = requete.genres;
	if (requete.typesFiche !== undefined) filtre.typesFiche = requete.typesFiche;
	if (requete.typesFicheExclus !== undefined) filtre.typesFicheExclus = requete.typesFicheExclus;

	// La synthèse d'une fiche est déjà dans l'élément de la fiche (titre et synthèse) : si celui-ci est trouvé, les passages
	// de sa synthèse ne le doublent pas, et ne prennent pas la place d'autres candidats (on en redemande autant).
	const sansDoublons = (liste: ElementIndexe[], fiches: Set<string>) =>
		liste.filter((e) => !(e.genre === 'passage' && fiches.has(e.chemin) && estPassageDeSynthese(e.id)));
	const fichesDe = (liste: ElementIndexe[]) => new Set(liste.filter((e) => e.genre === 'fiche').map((e) => e.id));
	const parLesMots = async (expressionFts: string): Promise<ElementIndexe[]> => {
		for (let demandes = candidats; ; ) {
			const bruts = await dep.index.chercher(expressionFts, filtre, demandes);
			const liste = sansDoublons(bruts, fichesDe(bruts));
			if (liste.length >= candidats || bruts.length < demandes) return liste.slice(0, candidats);
			demandes += candidats - liste.length;
		}
	};
	// liens résolus chargés une fois, au premier besoin (graphe, voisinage)
	let liensCharges: Promise<LiensResolus> | null = null;
	const liens = (): Promise<LiensResolus> => (liensCharges ??= liensDeLaMemoire(dep));
	const listes = [await parLesMots(expression.toutes)];
	if (listes[0]!.length < limite) listes.push(await parLesMots(expression.une));
	// Sens et graphe complètent les mots : ils ajoutent leur part sans compter dans la normalisation.
	const complementaires: number[] = [];
	const parLeSens = new Set<string>();
	const avecReranker = variante.reranker && options.reranker !== null;
	const modele = variante.sens && options.sens !== null ? dep.sens.modele() : null;
	const froid = modele === null ? null : await cacheTropFroid(dep, modele, options);
	if (froid !== null) {
		avis = `Cache de vecteurs froid (${froid.vecteurs} vecteurs) : étape « sens » sautée dans ce budget, recherche par les mots.`;
	} else if (modele !== null && options.sens !== null) {
		options.signal?.throwIfAborted();
		const budgetMs = Math.min(options.sensMaxMs ?? SENS_MAX_MS, options.fin - Date.now() - (avecReranker ? RESERVE_RERANKER_MS : 0));
		const sens = budgetMs <= 0 ? null : await listeDuSens(dep, requete.texte, filtre, { budgetMs, demarrer: options.sens.demarrer, activite: { operation: 'recherche' } }, options.sens.similariteMin);
		if (sens !== null) {
			avecSens = true;
			for (const e of sens) parLeSens.add(e.id);
			complementaires.push(listes.length);
			listes.push(sens);
		}
	}
	if (variante.graphe) {
		complementaires.push(listes.length);
		listes.push(await listeDuGraphe(dep, liens, fusionner(listes), expression.une, filtre, candidats));
	}
	let regles: Regles | null = null;
	const reglesDuCoffre = async (): Promise<Regles> => (regles ??= await chargerRegles(dep));
	// Un passage de document n'a pas de confiance propre : celle de son document, la fiabilité de son type de source. Un
	// passage d'une autre fiche (texte libre de la mémoire) compte comme la fiche elle-même.
	for (const liste of listes) {
		for (const e of liste) if (e.genre === 'passage' && estContenuDeDocument(e)) e.confiance = (await reglesDuCoffre()).fiabilites[e.typeSource ?? 'inconnue'];
	}
	// Même règle entre les listes (sens, graphe) : une fiche trouvée par l'une écarte les passages de sa synthèse des autres.
	const fiches = new Set(listes.flatMap((l) => [...fichesDe(l)]));
	for (const [i, liste] of listes.entries()) listes[i] = sansDoublons(liste, fiches);
	const fusion = fusionner(listes);
	const resteMs = options.fin - Date.now();
	if (avecReranker) options.signal?.throwIfAborted();
	const pertinences =
		avecReranker && resteMs >= RERANKER_MIN_MS ? await notesDuReranker(dep, requete.texte, fusion, { budgetMs: resteMs, demarrer: options.reranker!.demarrer, activite: { operation: 'recherche' } }) : null;
	const classes = classer(fusion, {
		listesComplementaires: complementaires,
		...(pertinences === null ? {} : { pertinences }),
	});
	const seuil = requete.sansSeuil === true ? 0 : (await reglesDuCoffre()).seuilRappel;
	const proches = variante.position ? await voisinage(dep, liens, requete.position) : new Set<string>();
	const reglages = dep.reglages().recherche;
	const poids: PoidsRecherche = { position: reglages.poidsPosition, confiance: reglages.poidsConfiance, memoire: reglages.poidsMemoire, fraicheur: reglages.poidsFraicheur };
	const jour = aujourdhui(dep);
	const fichesLues = new Map<string, Promise<string | null>>();
	// Le seuil porte sur la pertinence (échelle inchangée) : un poids ne fait jamais entrer un résultat. Un élément expiré
	// (validité passée, fiche périmée) ne revient qu'avec les invalides, comme un fait barré.
	const retenus = classes.filter((c) => c.pertinence >= seuil && (requete.inclureInvalides === true || !estExpire(c.element, jour)));
	const notes: (Classe & { note: NoteRecherche })[] = [];
	for (const c of retenus) {
		const e = c.element;
		const note = noterRecherche(
			c.base,
			{
				dansVoisinage: proches.has(e.chemin),
				confiance: await confianceDeRecherche(dep, e, await reglesDuCoffre(), fichesLues, async () => (await liens()).resoudre),
				deLaMemoire: !estContenuDeDocument(e),
				date: e.date,
				aujourdhui: jour,
			},
			poids,
		);
		notes.push({ ...c, note });
	}
	const notee = (rang: number) => Number.isFinite(rang);
	notes.sort(
		(a, b) =>
			b.note.total - a.note.total ||
			(notee(a.rangReranker) && notee(b.rangReranker) ? a.rangReranker - b.rangReranker : 0) ||
			(b.element.date ?? '').localeCompare(a.element.date ?? '') ||
			a.element.id.localeCompare(b.element.id),
	);

	// Une entrée par document et par contenu, après la note et le seuil, avant la coupe à `limite`. La fiche qu'un fait cite
	// est résolue comme le graphe (chemin, nom, titre, alias) ; une copie du voisinage de la position est montrée d'abord.
	const resoudre = async () => (await liens()).resoudre;
	const entrees: (typeof notes[number] & EntreeADedoublonner)[] = [];
	for (const n of notes) {
		const e = n.element;
		const lien = e.genre === 'fait' ? cibleDuLien(e.source) : null;
		const citee = lien === null ? null : ((await ficheCitee(e.source, resoudre)) ?? lien);
		entrees.push({ ...n, id: e.id, chemin: e.chemin, genre: e.genre, texte: e.texte, source: e.source, citee, date: e.date, voisin: proches.has(e.chemin) });
	}
	const sansDedoublonner = entrees.map((n) => ({ ...n, copies: [] as string[], mieuxClasse: n }));
	const uniques = requete.dedoublonner === false ? sansDedoublonner : dedoublonner(entrees, { memeDate: requete.dedoublonner === 'meme-date' });
	// L'entrée prend sa place par la note de son groupe (`score`, celle de son mieux classé) ; sa base et ses poids sont ceux
	// de l'élément montré (sa propre note) : ce qui est affiché vaut pour ce qui est montré.
	const versTrouve = ({ element: e, note, mieuxClasse, copies }: (typeof uniques)[number]): Trouve => ({
		id: e.id,
		chemin: e.chemin,
		genre: e.genre,
		typeFiche: e.typeFiche,
		texte: e.texte,
		contexte: e.contexte,
		statut: e.statut,
		date: e.date,
		valideFin: e.valideFin,
		finIncluse: e.finIncluse,
		categorie: e.categorie,
		portee: e.portee,
		confiance: e.confiance,
		source: e.source,
		typeSource: e.typeSource,
		...(e.genre === 'passage' ? { page: e.page ?? null } : {}),
		score: mieuxClasse.note.total,
		base: note.base,
		apports: note.apports,
		...(copies.length > 0 ? { copies } : {}),
	});
	const trouves = uniques.slice(0, limite).map(versTrouve);
	const bruts = sansDedoublonner.slice(0, limite).map(versTrouve);
	return { trouves, bruts, sens: avecSens, avis, notes: pertinences, parLeSens, motsUne: expression.une };
}

function memesValeurs(a: Float32Array, b: Float32Array): boolean {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

/**
 * Dépendances pour plusieurs recherches d'une même question sous une même échéance (`servir`) : le sens ne vectorise qu'une
 * fois un même texte, les vecteurs d'un modèle ne sont comptés qu'une fois, et l'index ne parcourt qu'une fois les vecteurs pour une même requête et un même filtre hors genres —
 * les `limite` plus proches de CHAQUE genre (`parGenre`), puis filtrés par genre et coupés à la limite de chaque appel :
 * mêmes résultats qu'un parcours par liste de genres, pour un seul parcours (~80 ms à chaud à 50 000 vecteurs).
 */
export function avecSensMemorise(dep: Dependances): Dependances {
	const deja = new Map<string, Promise<Float32Array[] | null>>();
	const sens: Sens = {
		modele: () => dep.sens.modele(),
		vecteurs(textes, options) {
			const cle = textes.join('\u0000');
			let promesse = deja.get(cle);
			if (promesse === undefined) {
				promesse = dep.sens.vecteurs(textes, options);
				deja.set(cle, promesse);
			}
			return promesse;
		},
	};
	// le nombre de vecteurs (garde du cache froid) est compté une fois par modèle
	const nombres = new Map<string, Promise<number>>();
	type Voisins = Awaited<ReturnType<Index['plusProches']>>;
	const parcours = new Map<string, { requete: Float32Array; limite: number; voisins: Promise<Voisins> }>();
	const index: Index = {
		...dep.index,
		nombreVecteurs(modele) {
			let n = nombres.get(modele);
			if (n === undefined) {
				n = dep.index.nombreVecteurs(modele);
				nombres.set(modele, n);
			}
			return n;
		},
		async plusProches(modele, requete, filtre, limite) {
			const { genres, ...reste } = filtre;
			const cle = `${modele}\u0000${JSON.stringify(reste)}`;
			let memo = parcours.get(cle);
			if (memo === undefined || memo.limite < limite || !memesValeurs(memo.requete, requete)) {
				memo = { requete, limite, voisins: dep.index.plusProches(modele, requete, reste, limite, { parGenre: true }) };
				parcours.set(cle, memo);
			}
			const voisins = await memo.voisins;
			return (genres === undefined ? voisins : voisins.filter((v) => genres.includes(v.genre))).slice(0, Math.max(0, Math.floor(limite)));
		},
	};
	return { ...dep, sens, index };
}

/**
 * Synchronise les fiches sans extraire aucun document (l'index sert tel quel), puis réveille la file d'extraction en
 * arrière-plan s'il y en a une : documents changés réextraits à part. Sans file (CLI), `mnemo index` les réextrait.
 */
async function synchroniserSansAttendre(dep: Dependances): Promise<BilanSynchro> {
	const bilan = await synchroniser(dep, SANS_EXTRACTION);
	dep.extractionDifferee?.reveiller();
	return bilan;
}

/** Synchronise l'index (sans attendre l'extraction des documents), puis cherche : la seule chaîne de recherche (outils, hooks, interface). */
export async function chercher(dep: Dependances, requete: Requete): Promise<Trouve[]> {
	return (await chercherAvecAvis(dep, requete)).trouves;
}

/**
 * Comme `chercher`, avec les avis de la synchronisation (documents à compléter : fils nouveaux d'un `.mbox`), les sources
 * dont le document a changé sans être encore réextrait (`differees` : la CLI renvoie à `mnemo index`) et les notes
 * du reranker par id (null s'il n'a pas tourné). `rapide` : les mots (et le graphe) seuls, sans aucun modèle ni
 * vectorisation — le premier temps de la recherche de l'interface. `demarrer` (vrai par défaut) : faux, les modèles
 * arrêtés ne sont pas attendus (l'étape saute) mais lancés en arrière-plan, pour la recherche suivante. `signal` : abandon (voir `OptionsRecherche`).
 */
export async function chercherAvecAvis(
	dep: Dependances,
	requete: Requete,
	o: { rapide?: boolean; demarrer?: boolean; signal?: AbortSignal } = {},
): Promise<{ trouves: Trouve[]; avis: Record<string, string>; notes: ReadonlyMap<string, number> | null; differees: string[] }> {
	// La recherche n'attend jamais l'extraction d'un document : les fiches sont synchronisées, l'index sert tel quel, et la
	// file d'arrière-plan (service, serveur MCP) est réveillée pour les documents changés ; ensuite, une seule échéance.
	const bilan = await synchroniserSansAttendre(dep);
	const differees = bilan.differees ?? [];
	/**
	 * Les avis de la file ne se lisent qu'une fois : pris seulement quand le résultat est prêt, après le dernier point
	 * d'abandon (une recherche remplacée ou abandonnée les laisse à la suivante).
	 */
	const avisFinal = (): Record<string, string> => {
		o.signal?.throwIfAborted();
		return { ...(dep.extractionDifferee?.avis() ?? {}), ...(bilan.avis ?? {}) };
	};
	o.signal?.throwIfAborted();
	if (o.rapide === true) {
		const { trouves } = await chercherDetaille(dep, requete, SANS_MODELE);
		return { trouves, avis: avisFinal(), notes: null, differees };
	}
	const demarrer = o.demarrer ?? true;
	const options: OptionsRecherche = { ...optionsOutils(Date.now(), demarrer, dep.reglages().contexte.similariteRecherche), ...(o.signal ? { signal: o.signal } : {}) };
	// Vecteurs de sens manquants, en laissant sa part à la recherche ; le modèle peut être lancé (en arrière-plan s'il tarde).
	const budgetMs = Math.min(VECTORISER_MAX_MS, options.fin - Date.now() - RESERVE_RECHERCHE_MS);
	if (budgetMs > 0) await vectoriser(dep, { budgetMs, demarrer, compter: false });
	o.signal?.throwIfAborted();
	const { trouves, notes } = await chercherDetaille(dep, requete, options);
	return { trouves, avis: avisFinal(), notes, differees };
}

export type Voisins = {
	fiche: string;
	sortants: Lien[];
	entrants: Lien[];
	/** Chemins, parmi les cibles des liens sortants, de fiches qui existent. */
	existants: string[];
	/** Chemins, parmi la fiche et les origines des liens entrants, de fiches qui sont des documents (à encadrer). */
	documents: string[];
};

/** Relations sortantes et liens entrants d'une fiche (ou de la fiche d'un élément `chemin#^…`), résolus comme le graphe ; null si elle est inconnue. */
export async function voisins(dep: Dependances, id: string): Promise<Voisins | null> {
	await synchroniserSansAttendre(dep);
	const fiche = id.split('#')[0]!;
	if ((await dep.index.element(fiche)) === null) return null;
	const liens = await liensDeLaFiche(dep, fiche);
	const sortants: Lien[] = liens.sortants.map((l) => ({ de: fiche, vers: l.chemin ?? `${l.ecrit}.md`, verbe: l.verbe }));
	const entrants: Lien[] = liens.entrants.map((l) => ({ de: l.chemin, vers: fiche, verbe: l.verbe }));
	const existants = new Set(liens.sortants.flatMap((l) => (l.chemin === null ? [] : [l.chemin])));
	const documents = new Set<string>();
	for (const chemin of [fiche, ...entrants.map((l) => l.de)]) {
		if ((await dep.index.element(chemin))?.typeFiche === 'source') documents.add(chemin);
	}

	return { fiche, sortants, entrants, existants: [...existants], documents: [...documents] };
}

/** Recherche sans seuil, triée par date croissante (date nulle en dernier). */
export async function chronologie(dep: Dependances, sujet: string, limite = dep.reglages().recherche.chronologie): Promise<Trouve[]> {
	await synchroniserSansAttendre(dep);
	// Triée par date ensuite : le reranker n'y changerait rien. Une entrée par document ; un même texte n'est regroupé qu'à
	// date égale : une chronologie dit quand chaque chose a été dite, deux dates sont deux moments.
	const trouves = await chercherSansSynchro(dep, { texte: sujet, limite, inclureAConfirmer: true, sansSeuil: true, dedoublonner: 'meme-date' }, { ...optionsOutils(Date.now(), true, dep.reglages().contexte.similariteRecherche), reranker: null });

	return trouves.sort((a, b) => {
		if (a.date === b.date) return 0;
		if (a.date === null) return 1;
		if (b.date === null) return -1;
		return a.date.localeCompare(b.date);
	});
}
