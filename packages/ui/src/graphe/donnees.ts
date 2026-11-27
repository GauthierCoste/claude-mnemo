/**
 * Données du graphe de la mémoire, sans three.js : fiches, liens, légendes, filtres et voisinage. Les couleurs
 * viennent des jetons (`CouleursGraphe`, passées en paramètre). Les notions (absentes de Mnemo) restent dans le code des
 * données, sans interface.
 */
import type { FicheGraphe, LienGraphe } from '@mnemo/contrat';
import { plier } from '@mnemo/commun';
import type { CouleursGraphe } from './couleurs.ts';
import { rangsDesBranches } from './branches.ts';
import { TEXTES, type Textes } from '../langue/textes.ts';

/** Textes du graphe (légende, états, types de lien) ; le français par défaut pour un appelant sans langue. */
export type TextesGraphe = Textes['memoire']['graphe'];

/** Une notion du sens ; Mnemo n'en envoie jamais. */
export type NotionGraphe = { id: string; nom: string; mots?: string[]; faits?: number; fiches?: number };

/** Forme d'entrée de `preparerGraphe` : `DonneesGraphe` du service, ou des données partielles (tests). */
export type EntreeGraphe = {
	coffre?: string;
	fiches?: (Pick<FicheGraphe, 'chemin' | 'titre'> & Partial<Omit<FicheGraphe, 'chemin' | 'titre' | 'etats'>> & { etats?: string[]; notions?: Record<string, number> })[];
	liens?: LienGraphe[];
	notions?: NotionGraphe[];
	sens?: { disponible?: boolean; etat?: string };
};

/** Types de lien que l'utilisateur choisit de voir et de suivre : la parenté de l'arbre, les liens `[[…]]` écrits dans les fiches. */
export const TYPES_DE_LIEN = ['parente', 'personnalise'] as const;
export type TypeDeLien = (typeof TYPES_DE_LIEN)[number];

/** `notion` : fiche vers une notion de ses faits, jamais choisi ni suivi dans Mnemo. */
export type LienNoeud = { id: number; type: TypeDeLien | 'notion'; source: Noeud; cible: Noeud; relation: string | null; casse?: boolean; faits?: number };

export type Noeud = {
	id: number;
	/** Clé d'une notion (`notion:<id>`). */
	cle?: string;
	chemin: string | null;
	titre: string;
	alias: string[];
	etats: string[];
	faitsActifs: number;
	categories: Record<string, number>;
	dates: string[];
	branche: string;
	racine: string;
	fantome: boolean;
	notion?: boolean;
	notionId?: string;
	mots?: string[];
	nombreFiches?: number;
	couleurNotion?: string;
	/** Fiches d'une notion. */
	fiches: Noeud[];
	sortants: LienNoeud[];
	entrants: LienNoeud[];
	parent: Noeud | null;
	enfants: Noeud[];
	/** Notions d'une fiche, la principale d'abord. */
	notions: { notion: Noeud; faits: number }[];
	notionPrincipale: Noeud | null;
	voisins: Set<Noeud>;
	relations: number;
	// Lecture courante (légende, taille, filtres).
	legende: string;
	couleur: string;
	taille: number;
	visible: boolean;
	// Disposition.
	x: number;
	y: number;
	z: number;
	vx: number;
	vy: number;
	vz: number;
	tx: number;
	ty: number;
	tz: number;
	epingle?: boolean;
};

export type GraphePrepare = {
	coffre: string;
	noeuds: Noeud[];
	liens: LienNoeud[];
	parentes: LienNoeud[];
	notions: Noeud[];
	liensDeNotion: LienNoeud[];
	sens: { disponible: boolean; etat: string };
	branches: [string, number][];
	typesDeRelation: [string, number][];
	categories: [string, number][];
	compteurs: { fiches: number; liens: number; liensCasses: number; sansRelation: number };
	couleurs: CouleursGraphe;
};

/** États mémoire connus d'une fiche, dans l'ordre de la légende et du filtre. */
export const ETATS = ['a_confirmer', 'a_reprendre', 'illisible'] as const;
export type EtatMemoire = (typeof ETATS)[number];
const estEtatConnu = (etat: string): etat is EtatMemoire => (ETATS as readonly string[]).includes(etat);

/** Nom d'un état mémoire ; un état inconnu tel quel. */
export const nomDEtat = (etat: string, t: TextesGraphe = TEXTES.fr.memoire.graphe): string => (estEtatConnu(etat) ? t.etats[etat] : etat);

// Clés des catégories de légende réservées : entre crochets, elles ne se confondent pas avec un chemin de branche.
export const LIEN_CASSE = '[lien-casse]';
export const SANS_NOTION = '[sans-notion]';
export const NOTION = '[notion]';
export const SANS_REMARQUE = '[sans-remarque]';
export const SANS_DATE = '[sans-date]';
export const RACINE = '[racine]';
const cleDEtat = (etat: EtatMemoire): string => `[etat:${etat}]`;
/** Relation d'un lien écrit dans une information, sans relation nommée (une clé : `nomDeRelation` l'affiche). */
export const RELATION_DANS_UN_FAIT = 'cité dans une information';

/** Nom affiché d'une relation : celle d'une information traduite, les autres (données de la mémoire) telles quelles. */
export const nomDeRelation = (relation: string, t: TextesGraphe = TEXTES.fr.memoire.graphe): string => (relation === RELATION_DANS_UN_FAIT ? t.relationDansUnFait : relation);

export type ModeCouleur = 'branche' | 'sousdossier' | 'etat' | 'periode' | 'notion';
export type ModeTaille = 'relations' | 'faits' | 'uniforme';

/** `nom` : clé du cran (son nom affiché : `t.memoire.graphe.densites`). */
export type Densite = { nom: 'Aucune' | 'Peu' | 'Normale' | 'Beaucoup' | 'Toutes'; maximum: number; chevauchements: boolean };

// Crans de densité des étiquettes ; « Toutes » ne masque plus les étiquettes qui se chevauchent.
export const DENSITES_ETIQUETTES: Densite[] = [
	{ nom: 'Aucune', maximum: 0, chevauchements: false },
	{ nom: 'Peu', maximum: 12, chevauchements: false },
	{ nom: 'Normale', maximum: 26, chevauchements: false },
	{ nom: 'Beaucoup', maximum: 70, chevauchements: false },
	{ nom: 'Toutes', maximum: Infinity, chevauchements: true },
];
export const DENSITE_PAR_DEFAUT = 2;

/**
 * Cran de densité lu (stockage, curseur) : un entier dans les bornes, sinon le cran par défaut.
 */
export function cranDeDensite(valeur: unknown): number {
	const cran = valeur === null || valeur === undefined || valeur === '' ? NaN : Number(valeur);
	return Number.isInteger(cran) && cran >= 0 && cran < DENSITES_ETIQUETTES.length ? cran : DENSITE_PAR_DEFAUT;
}

const JOUR_MS = 86400000;
// Périodes de validité (or, accent, confirmation, information) ; leurs couleurs sont prises dans la palette des branches
// au même rang.
type Periode = 'avenir' | 'moinsDUnAn' | 'unATroisAns' | 'plusDeTroisAns';
const PERIODES: { periode: Periode; cle: string; rangCouleur: number }[] = (
	[
		['avenir', 1],
		['moinsDUnAn', 0],
		['unATroisAns', 2],
		['plusDeTroisAns', 4],
	] as const
).map(([periode, rangCouleur]) => ({ periode, cle: `[periode:${periode}]`, rangCouleur }));

const couleurDeRang = (couleurs: CouleursGraphe, rang: number): string => couleurs.branches[rang % couleurs.branches.length] ?? couleurs.texteSecondaire;

/**
 * Minuscules sans accents ni espaces multiples : la comparaison du filtre instantané.
 */
export function normaliser(texte: string): string {
	return plier(String(texte)).replace(/\s+/g, ' ').trim();
}

function noeudVide(id: number, titre: string): Noeud {
	return {
		id,
		chemin: null,
		titre,
		alias: [],
		etats: [],
		faitsActifs: 0,
		categories: {},
		dates: [],
		branche: '',
		racine: '',
		fantome: false,
		fiches: [],
		sortants: [],
		entrants: [],
		parent: null,
		enfants: [],
		notions: [],
		notionPrincipale: null,
		voisins: new Set(),
		relations: 0,
		legende: '',
		couleur: '',
		taille: 0,
		visible: false,
		x: 0,
		y: 0,
		z: 0,
		vx: 0,
		vy: 0,
		vz: 0,
		tx: 0,
		ty: 0,
		tz: 0,
	};
}

/** Clé stable d'un nœud d'une lecture à l'autre : positions et épingles la suivent. */
export function cleDuNoeud(noeud: Pick<Noeud, 'cle' | 'chemin' | 'titre'>): string {
	return noeud.cle ?? noeud.chemin ?? `lien:${noeud.titre}`;
}

/**
 * Nœuds (fiches, notions, puis cibles des liens cassés), liens directs, liens de parenté et liens de notion prêts pour
 * la scène. Un lien vers une fiche absente du coffre aboutit à un nœud « lien cassé » par cible écrite. La parenté (une
 * fiche vers la fiche de dossier de sa branche) vient de l'arbre, le lien de notion (une fiche vers une notion de ses
 * faits) vient du sens : ni l'un ni l'autre ne compte comme relation.
 */
export function preparerGraphe(donnees: EntreeGraphe, couleurs: CouleursGraphe): GraphePrepare {
	const noeuds: Noeud[] = [];
	const parChemin = new Map<string, Noeud>();
	for (const fiche of donnees.fiches ?? []) {
		const noeud: Noeud = {
			...noeudVide(noeuds.length, fiche.titre),
			chemin: fiche.chemin,
			alias: fiche.alias ?? [],
			etats: fiche.etats ?? [],
			faitsActifs: fiche.faitsActifs ?? 0,
			categories: fiche.categories ?? {},
			dates: fiche.dates ?? [],
			branche: fiche.branche ?? '',
			racine: (fiche.branche ?? '').split('/')[0] ?? '',
		};
		noeuds.push(noeud);
		parChemin.set(fiche.chemin, noeud);
	}
	const notions: Noeud[] = [];
	const parNotion = new Map<string, Noeud>();
	for (const [rang, donnee] of (donnees.notions ?? []).entries()) {
		const noeud: Noeud = {
			...noeudVide(noeuds.length, donnee.nom),
			cle: `notion:${donnee.id}`,
			notionId: donnee.id,
			mots: donnee.mots ?? [],
			faitsActifs: donnee.faits ?? 0,
			nombreFiches: donnee.fiches ?? 0,
			notion: true,
			couleurNotion: couleurDeRang(couleurs, rang),
		};
		noeuds.push(noeud);
		notions.push(noeud);
		parNotion.set(donnee.id, noeud);
	}
	const liensDeNotion: LienNoeud[] = [];
	for (const fiche of donnees.fiches ?? []) {
		const noeud = parChemin.get(fiche.chemin)!;
		noeud.notions = [];
		for (const [identifiant, faits] of Object.entries(fiche.notions ?? {})) {
			const notion = parNotion.get(identifiant);
			if (notion) {
				noeud.notions.push({ notion, faits });
				notion.fiches.push(noeud);
				liensDeNotion.push({ id: liensDeNotion.length, type: 'notion', source: noeud, cible: notion, relation: null, faits });
			}
		}
		noeud.notions.sort((a, b) => b.faits - a.faits || notions.indexOf(a.notion) - notions.indexOf(b.notion));
		noeud.notionPrincipale = noeud.notions[0]?.notion ?? null;
	}
	const parentes: LienNoeud[] = [];
	for (const fiche of donnees.fiches ?? []) {
		const noeud = parChemin.get(fiche.chemin)!;
		const parent = fiche.parent ? parChemin.get(fiche.parent) : null;
		if (parent && parent !== noeud) {
			noeud.parent = parent;
			parent.enfants.push(noeud);
			parentes.push({ id: parentes.length, type: 'parente', source: noeud, cible: parent, relation: null });
		}
	}
	const fantomes = new Map<string, Noeud>();
	const liens: LienNoeud[] = [];
	const typesDeRelation = new Map<string, number>();
	for (const donnee of donnees.liens ?? []) {
		const source = parChemin.get(donnee.source);
		if (!source) continue;
		let cible = donnee.cible === null ? undefined : parChemin.get(donnee.cible);
		if (!cible) {
			const cle = normaliser(donnee.cibleEcrite);
			cible = fantomes.get(cle);
			if (!cible) {
				cible = { ...noeudVide(noeuds.length, donnee.cibleEcrite), fantome: true };
				fantomes.set(cle, cible);
				noeuds.push(cible);
			}
		}
		const relation = donnee.relation ?? RELATION_DANS_UN_FAIT;
		const lien: LienNoeud = { id: liens.length, type: 'personnalise', source, cible, relation, casse: cible.fantome };
		liens.push(lien);
		source.sortants.push(lien);
		cible.entrants.push(lien);
		typesDeRelation.set(relation, (typesDeRelation.get(relation) ?? 0) + 1);
	}
	for (const noeud of noeuds) {
		const voisins = new Set([...noeud.sortants.map((lien) => lien.cible), ...noeud.entrants.map((lien) => lien.source)]);
		voisins.delete(noeud);
		noeud.voisins = voisins;
		noeud.relations = voisins.size;
	}
	const fiches = noeuds.filter((noeud) => !noeud.fantome && !noeud.notion);

	return {
		coffre: donnees.coffre ?? '',
		noeuds,
		liens,
		parentes,
		notions,
		liensDeNotion,
		sens: { disponible: Boolean(donnees.sens?.disponible), etat: donnees.sens?.etat ?? '' },
		branches: branchesDuCoffre(fiches),
		typesDeRelation: [...typesDeRelation].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
		categories: categoriesDuCoffre(fiches),
		compteurs: {
			fiches: fiches.length,
			liens: liens.filter((lien) => !lien.casse).length,
			liensCasses: liens.filter((lien) => lien.casse).length,
			sansRelation: fiches.filter((noeud) => noeud.relations === 0).length,
		},
		couleurs,
	};
}

/**
 * Chaque branche de l'arbre, sous-branches comprises, avec son nombre de fiches (celles des sous-branches incluses),
 * dans l'ordre de l'arbre.
 */
function branchesDuCoffre(fiches: Noeud[]): [string, number][] {
	const nombres = new Map<string, number>();
	for (const noeud of fiches) {
		const noms = noeud.branche === '' ? [] : noeud.branche.split('/');
		for (let profondeur = 1; profondeur <= noms.length; profondeur++) {
			const branche = noms.slice(0, profondeur).join('/');
			nombres.set(branche, (nombres.get(branche) ?? 0) + 1);
		}
	}
	return [...nombres].sort((a, b) => ordreDeLArbre(a[0], b[0]));
}

/**
 * Une branche, puis ses sous-branches, avant sa voisine : comparaison nom par nom.
 */
function ordreDeLArbre(a: string, b: string): number {
	const nomsA = a.split('/');
	const nomsB = b.split('/');
	for (let rang = 0; rang < Math.min(nomsA.length, nomsB.length); rang++) {
		const ordre = nomsA[rang]!.localeCompare(nomsB[rang]!, 'fr');
		if (ordre !== 0) return ordre;
	}
	return nomsA.length - nomsB.length;
}

/**
 * Une fiche est dans une branche si elle y est rangée ou dans l'une de ses sous-branches ; la branche vide est tout le
 * coffre.
 */
export function dansLaBranche(noeud: Pick<Noeud, 'branche'>, branche: string | undefined): boolean {
	return !branche || noeud.branche === branche || noeud.branche.startsWith(`${branche}/`);
}

function categoriesDuCoffre(fiches: Noeud[]): [string, number][] {
	const nombres = new Map<string, number>();
	for (const noeud of fiches) {
		for (const categorie of Object.keys(noeud.categories)) nombres.set(categorie, (nombres.get(categorie) ?? 0) + 1);
	}
	return [...nombres].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * Date médiane des débuts et fins de validité des faits actifs d'une fiche, en millisecondes ; null sans date.
 */
export function dateMediane(noeud: Pick<Noeud, 'dates'>): number | null {
	const dates = noeud.dates
		.map((date) => Date.parse(`${date}T00:00:00Z`))
		.filter(Number.isFinite)
		.sort((a, b) => a - b);
	if (dates.length === 0) return null;
	const milieu = Math.floor(dates.length / 2);
	return dates.length % 2 === 1 ? dates[milieu]! : (dates[milieu - 1]! + dates[milieu]!) / 2;
}

function periode(noeud: Noeud, maintenant: number): string {
	const date = dateMediane(noeud);
	if (date === null) return SANS_DATE;
	const jours = (maintenant - date) / JOUR_MS;
	if (jours < 0) return PERIODES[0]!.cle;
	return jours < 365 ? PERIODES[1]!.cle : jours < 3 * 365 ? PERIODES[2]!.cle : PERIODES[3]!.cle;
}

/**
 * Catégorie de légende d'un nœud selon le mode de couleur : `branche` (premier niveau de l'arbre), `sousdossier` (son
 * dossier), `notion` (clé de sa notion principale : deux notions peuvent porter le même nom), `etat` ou `periode`.
 */
export function categorieDeLegende(noeud: Noeud, mode: string, maintenant: number): string {
	if (noeud.fantome) return LIEN_CASSE;
	if (noeud.notion) return NOTION;
	if (mode === 'notion') return noeud.notionPrincipale?.cle ?? SANS_NOTION;
	if (mode === 'etat') {
		const etat = noeud.etats[0];
		return etat !== undefined && estEtatConnu(etat) ? cleDEtat(etat) : SANS_REMARQUE;
	}
	if (mode === 'periode') return periode(noeud, maintenant);
	if (mode === 'sousdossier') return noeud.branche || RACINE;
	return noeud.racine || RACINE;
}

function versTsl(hexadecimal: string): [number, number, number] {
	const [r, v, b] = [1, 3, 5].map((debut) => parseInt(hexadecimal.slice(debut, debut + 2), 16) / 255) as [number, number, number];
	const haut = Math.max(r, v, b);
	const bas = Math.min(r, v, b);
	const luminosite = (haut + bas) / 2;
	if (haut === bas) return [0, 0, luminosite];
	const ecart = haut - bas;
	const saturation = luminosite > 0.5 ? ecart / (2 - haut - bas) : ecart / (haut + bas);
	const teinte = haut === r ? (v - b) / ecart + (v < b ? 6 : 0) : haut === v ? (b - r) / ecart + 2 : (r - v) / ecart + 4;
	return [teinte / 6, saturation, luminosite];
}

function depuisTsl(teinte: number, saturation: number, luminosite: number): string {
	const q = luminosite < 0.5 ? luminosite * (1 + saturation) : luminosite + saturation - luminosite * saturation;
	const p = 2 * luminosite - q;
	const canal = (t: number) => {
		const u = (t + 1) % 1;
		const valeur = u < 1 / 6 ? p + (q - p) * 6 * u : u < 1 / 2 ? q : u < 2 / 3 ? p + (q - p) * (2 / 3 - u) * 6 : p;
		return Math.round(valeur * 255)
			.toString(16)
			.padStart(2, '0');
	};
	return `#${canal(teinte + 1 / 3)}${canal(teinte)}${canal(teinte - 1 / 3)}`;
}

/**
 * Nuance proche d'une couleur, pour la `rang`-ième sous-branche : teinte légèrement tournée, clarté alternée.
 */
export function nuance(couleur: string, rang: number): string {
	if (rang === 0) return couleur;
	const [teinte, saturation, luminosite] = versTsl(couleur);
	const pas = Math.ceil(rang / 2) * (rang % 2 === 1 ? 1 : -1);
	return depuisTsl(teinte + pas * 0.018, saturation, Math.min(0.88, Math.max(0.42, luminosite + pas * 0.07)));
}

/**
 * Couleur de chaque branche lue dans l'arbre réel, sans liste écrite dans le code : une teinte distincte par branche de
 * premier niveau (ordre alphabétique), ses sous-dossiers en nuances proches de la sienne.
 *
 * @return nom de légende (`racine` ou chemin de la branche ; RACINE pour la racine) → couleur
 */
export function couleursDesBranches(noeuds: Noeud[], couleurs: CouleursGraphe, niveau: string = 'branche'): Map<string, string> {
	const fiches = noeuds.filter((noeud) => !noeud.fantome && !noeud.notion);
	const rangs = rangsDesBranches(fiches.map((noeud) => noeud.racine));
	const racines = [...rangs.keys()];
	const parRacine = new Map([...rangs].map(([racine, rang]) => [racine || RACINE, couleurDeRang(couleurs, rang)]));
	if (niveau !== 'sousdossier') return parRacine;
	const parBranche = new Map<string, string>();
	for (const racine of racines) {
		const branches = [...new Set(fiches.filter((noeud) => noeud.racine === racine).map((noeud) => noeud.branche))].sort((a, b) => a.localeCompare(b));
		const base = parRacine.get(racine || RACINE)!;
		const sousBranches = branches.filter((branche) => branche !== racine);
		if (branches.includes(racine)) parBranche.set(racine || RACINE, base);
		sousBranches.forEach((branche, rang) => parBranche.set(branche, nuance(base, rang + 1)));
	}
	return parBranche;
}

function couleurDeLegende(nom: string, parNom: Map<string, string>, couleurs: CouleursGraphe): string {
	const connue = parNom.get(nom);
	if (connue) return connue;
	for (const etat of ETATS) if (cleDEtat(etat) === nom && couleurs.etats[etat]) return couleurs.etats[etat];
	for (const entree of PERIODES) if (entree.cle === nom) return couleurDeRang(couleurs, entree.rangCouleur);
	return nom === LIEN_CASSE ? couleurs.discret : couleurs.texteSecondaire;
}

export type EntreeLegende = { cle: string; nom: string; nombre: number; couleur: string };

/** Nom affiché d'une catégorie de légende : une clé réservée traduite, sinon la clé (chemin de branche). */
export function nomDeLegende(cle: string, t: TextesGraphe = TEXTES.fr.memoire.graphe): string {
	const reservees: Record<string, string> = {
		[LIEN_CASSE]: t.legende.lienCasse,
		[NOTION]: t.legende.notion,
		[SANS_NOTION]: t.legende.sansNotion,
		[SANS_REMARQUE]: t.legende.sansRemarque,
		[SANS_DATE]: t.legende.sansDate,
		[RACINE]: t.legende.racine,
	};
	for (const etat of ETATS) reservees[cleDEtat(etat)] = t.etats[etat];
	for (const entree of PERIODES) reservees[entree.cle] = t.legende.periodes[entree.periode];
	return reservees[cle] ?? cle;
}

/**
 * Légende du mode de couleur, dans l'ordre de ses catégories : chaque nœud reçoit `legende` (clé de sa catégorie) et
 * `couleur` ; chaque entrée a sa clé, son nom affiché, son nombre de fiches retenues par `retenue` (les autres filtres)
 * et sa couleur. Une catégorie sans fiche retenue reste dans la légende, à zéro.
 */
export function construireLegende(
	noeuds: Noeud[],
	mode: string,
	maintenant: number,
	couleurs: CouleursGraphe,
	retenue: (noeud: Noeud) => boolean = () => true,
	textes: TextesGraphe = TEXTES.fr.memoire.graphe,
): EntreeLegende[] {
	const nombres = new Map<string, number>();
	const notions = noeuds.filter((noeud) => noeud.notion);
	const noms = new Map(mode === 'notion' ? notions.map((notion) => [notion.cle!, notion.titre]) : []);
	const parNom =
		mode === 'notion'
			? new Map(notions.map((notion) => [notion.cle!, notion.couleurNotion!]))
			: mode === 'branche' || mode === 'sousdossier'
				? couleursDesBranches(noeuds, couleurs, mode)
				: new Map<string, string>();
	for (const noeud of noeuds) {
		noeud.legende = categorieDeLegende(noeud, mode, maintenant);
		noeud.couleur = noeud.notion ? noeud.couleurNotion! : couleurDeLegende(noeud.legende, parNom, couleurs);
		if (!noeud.fantome && !noeud.notion) nombres.set(noeud.legende, (nombres.get(noeud.legende) ?? 0) + (retenue(noeud) ? 1 : 0));
	}
	const ordre =
		mode === 'etat'
			? [...ETATS.map(cleDEtat), SANS_REMARQUE]
			: mode === 'periode'
				? [...PERIODES.map((entree) => entree.cle), SANS_DATE]
				: mode === 'notion'
					? [...notions.map((notion) => notion.cle!), SANS_NOTION]
					: [...parNom.keys()];
	const cles = [...ordre.filter((cle) => nombres.has(cle)), ...[...nombres.keys()].filter((cle) => !ordre.includes(cle))];

	return cles.map((cle) => ({ cle, nom: noms.get(cle) ?? nomDeLegende(cle, textes), nombre: nombres.get(cle)!, couleur: couleurDeLegende(cle, parNom, couleurs) }));
}

/**
 * Taille d'un nœud : selon ses relations, ses faits actifs, ou uniforme ; un lien cassé reste petit ; une notion a la
 * taille d'une fiche moyenne, jamais plus grosse que les fiches.
 */
export function tailleDuNoeud(noeud: Noeud, mode: string): number {
	if (noeud.fantome) return 5;
	if (noeud.notion) return 9;
	if (mode === 'faits') return 6 + Math.sqrt(noeud.faitsActifs) * 2.2;
	return mode === 'uniforme' ? 9 : 6 + Math.sqrt(noeud.relations) * 3;
}

/**
 * Un lien est dessiné si ses deux bouts sont visibles et que son type de relation n'est pas masqué.
 */
export function lienVisible(lien: LienNoeud, relationsMasquees: Set<string | null>): boolean {
	return lien.source.visible && lien.cible.visible && !relationsMasquees.has(lien.relation);
}

/** Liens des types choisis, dans l'ordre de `TYPES_DE_LIEN` ; aucun type : aucun lien. */
export function liensDesTypes(graphe: Pick<GraphePrepare, 'liens' | 'parentes'>, types: ReadonlySet<TypeDeLien>): LienNoeud[] {
	const parType: Record<TypeDeLien, LienNoeud[]> = { parente: graphe.parentes, personnalise: graphe.liens };
	return TYPES_DE_LIEN.flatMap((type) => (types.has(type) ? parType[type] : []));
}

/** Fiches reliées directement à `noeud` par `liens` (« Relié à ») : le voisinage à un lien, sans le nœud lui-même. */
export function voisinsDirects(noeud: Noeud, liens: LienNoeud[]): Noeud[] {
	const voisins = voisinage(noeud, 1, liens);
	voisins.delete(noeud);
	return [...voisins];
}

/**
 * Voisinage d'un nœud jusqu'à `profondeur` liens, par les liens donnés, quel que soit leur type.
 */
export function voisinage(depart: Noeud, profondeur: number, liensVisibles: LienNoeud[]): Set<Noeud> {
	const adjacence = new Map<Noeud, Noeud[]>();
	for (const lien of liensVisibles) {
		for (const [de, vers] of [
			[lien.source, lien.cible],
			[lien.cible, lien.source],
		] as const) {
			const liste = adjacence.get(de) ?? [];
			adjacence.set(de, liste);
			liste.push(vers);
		}
	}
	const vus = new Set([depart]);
	let front = [depart];
	for (let etape = 0; etape < profondeur; etape++) {
		const suivant: Noeud[] = [];
		for (const noeud of front) {
			for (const voisin of adjacence.get(noeud) ?? []) {
				if (!vus.has(voisin)) {
					vus.add(voisin);
					suivant.push(voisin);
				}
			}
		}
		front = suivant;
	}
	return vus;
}

/**
 * Filtre instantané sur titres et alias : un titre qui commence par le texte d'abord, puis un titre qui le contient,
 * puis un alias.
 */
export function filtrerParTitre(noeuds: Noeud[], texte: string): Noeud[] {
	const cherche = normaliser(texte);
	if (cherche === '') return [];
	const trouves: { noeud: Noeud; rang: number }[] = [];
	for (const noeud of noeuds) {
		if (noeud.fantome || noeud.notion) continue;
		const titre = normaliser(noeud.titre);
		const rang = titre.startsWith(cherche) ? 0 : titre.includes(cherche) ? 1 : noeud.alias.some((alias) => normaliser(alias).includes(cherche)) ? 2 : -1;
		if (rang >= 0) trouves.push({ noeud, rang });
	}
	return trouves.sort((a, b) => a.rang - b.rang || a.noeud.titre.localeCompare(b.noeud.titre)).map((trouve) => trouve.noeud);
}

export type Filtres = { branche?: string; etat?: string; categorie?: string; notion?: string; liens?: string };

/**
 * Filtres de la recherche : branche, état mémoire, catégorie de fait, notion, liens (`aucun`, `nombreux` : 5 et
 * plus, `casses`).
 */
export function correspondAuxFiltres(noeud: Noeud, filtres: Filtres): boolean {
	if (noeud.fantome || noeud.notion || !dansLaBranche(noeud, filtres.branche)) return false;
	if (filtres.notion && !noeud.notions.some((entree) => entree.notion.notionId === filtres.notion)) return false;
	if (filtres.etat && (filtres.etat === 'aucun' ? noeud.etats.length > 0 : !noeud.etats.includes(filtres.etat))) return false;
	if (filtres.categorie && !(filtres.categorie in noeud.categories)) return false;
	if (filtres.liens === 'aucun' && noeud.relations > 0) return false;
	if (filtres.liens === 'nombreux' && noeud.relations < 5) return false;
	return !(filtres.liens === 'casses' && !noeud.sortants.some((lien) => lien.casse));
}

export type Choix = { legende: Set<string>; notions: Set<string> };

/**
 * Choix de la légende et des notions, croisés : une fiche est gardée si sa catégorie est choisie (ou aucune) et si
 * l'une de ses notions est choisie (ou aucune). Plusieurs choix d'un même côté s'additionnent.
 */
export function retenueParLesChoix(noeud: Noeud, choix: Choix): boolean {
	if (choix.legende.size > 0 && !choix.legende.has(noeud.legende)) return false;
	return choix.notions.size === 0 || noeud.notions.some((entree) => choix.notions.has(entree.notion.notionId!));
}

export function filtresActifs(filtres: Filtres): number {
	return Object.values(filtres).filter((valeur) => valeur !== '' && valeur !== null && valeur !== undefined).length;
}
