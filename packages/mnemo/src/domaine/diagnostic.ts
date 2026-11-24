/**
 * Diagnostic de la mémoire (outil `diagnostiquer`) : calcul pur, à partir des fiches lues, de leurs dossiers et de la
 * résolution des liens. Chaque rubrique rend ses entrées (chemin, et ancre pour une information) dans l'ordre des chemins.
 * Coût linéaire en taille de la mémoire, sauf les doublons probables, comparés deux à deux dans une même fiche seulement.
 */
import { DOSSIERS_FIXES, EXTENSIONS_EXTRAITES, extensionDe, plier } from '@mnemo/commun';
import { cleDeCasse, ficheDeDossier, nomDeLaFiche, positionDeFiche } from './chemin.ts';
import { empreinte } from './empreinte.ts';
import type { Fait } from './fait.ts';
import type { Fiche } from './fiche.ts';
import { liensEcrits } from './liens-ecrits.ts';
import type { Lot } from './lot.ts';
import { CLE_A_TRAITER, descripteurDeSource } from './source.ts';
import { tronquerTexte } from './texte.ts';

export const RUBRIQUES = [
	'liens_casses',
	'fiches_isolees',
	'sans_synthese',
	'dossiers',
	'sous_seuil',
	'a_confirmer',
	'barrees',
	'doublons',
	'fiches_chargees',
	'sources_en_double',
	'sources_non_citees',
	'categories_rares',
	'nom_titre',
	'lots_en_attente',
] as const;
export type Rubrique = (typeof RUBRIQUES)[number];

/** Au-delà de ce nombre d'informations (barrées comprises), une fiche est signalée : à scinder ou à épurer. */
export const SEUIL_FICHE_CHARGEE = 40;
/** Une catégorie employée au plus ce nombre de fois est signalée, pour l'harmoniser avec une catégorie courante. */
export const SEUIL_CATEGORIE_RARE = 2;
/**
 * Similarité (coefficient de Dice sur les trigrammes de caractères des textes normalisés) à partir de laquelle deux
 * informations d'une même fiche sont des doublons probables ; deux textes aux nombres différents ne le sont jamais.
 */
export const SEUIL_DOUBLON = 0.8;
/**
 * Écart de longueur au-delà duquel deux textes ne sont pas comparés : sous `SEUIL_DOUBLON`, le plus court fait au moins les
 * deux tiers du plus long (Dice ≥ 0,8 l'impose sur les trigrammes) ; 0,7 laisse une marge.
 */
export const RAPPORT_LONGUEUR_MIN = 0.7;
/** Informations non barrées d'une fiche comparées deux à deux pour les doublons, au plus (les premières) : temps borné. */
export const INFORMATIONS_COMPAREES_MAX = 300;

/**
 * Extensions de fichiers qui ne sont pas des fiches (pièces jointes, images, documents) : un lien `[[photo.png]]` ou
 * `![[plan.pdf]]` vers l'un d'eux n'est pas un lien cassé de la mémoire.
 */
export const EXTENSIONS_HORS_FICHES: ReadonlySet<string> = new Set([
	...EXTENSIONS_EXTRAITES,
	'.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.tif', '.tiff', '.heic', '.avif', '.ico',
	'.txt', '.csv', '.doc', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.rtf', '.msg',
	'.mp3', '.m4a', '.wav', '.mp4', '.mov', '.webm', '.zip', '.canvas', '.base',
]);

/** Ordre des points de code (pas celui de la langue) : stable d'une machine à l'autre. */
export function parPointsDeCode(a: string, b: string): number {
	const x = [...a];
	const y = [...b];
	for (let i = 0; i < Math.min(x.length, y.length); i++) {
		const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
		if (d !== 0) return d;
	}
	return x.length - y.length;
}

export type FicheLue = { chemin: string; texte: string; fiche: Fiche };

export type EntreeDiagnostic = {
	/** Toutes les fiches de la mémoire (fichiers `.md`), lues. */
	fiches: readonly FicheLue[];
	/** Tous les dossiers non cachés de la mémoire (relatifs à `_mnemo/`, racine exclue). */
	dossiers: readonly string[];
	/** Fiche désignée par la cible d'un lien telle qu'écrite (sans `#…` ni `|…`), ou null : absente, ambiguë, hors mémoire. */
	designee: (cible: string) => string | null;
	/** Empreinte du document de chaque fiche `source` connue de l'index ; à défaut, celle de son frontmatter. */
	empreintesSources: ReadonlyMap<string, string>;
	/** `seuil_rappel` de SCHEMA.md (0 à 1). */
	seuilRappel: number;
	/** Catégories à fort enjeu : jamais signalées comme rares. */
	categoriesAEnjeu: readonly string[];
	/** Lots d'informations proposés, en attente de l'utilisateur (état local) ; absent : aucun. */
	lots?: readonly Lot[];
};

export type Diagnostic = {
	fiches: number;
	informations: number;
	rubriques: { rubrique: Rubrique; entrees: string[] }[];
};

const TYPES_HORS_ENTRETIEN = new Set(['consigne', 'profil']);
const RE_ANCRE_DE_FAIT = /^f-\d+$/u;
const LONGUEUR_EXTRAIT = 80;

/** Fiche que l'entretien ne touche pas (SCHEMA.md, consigne, profil, `profils/`, `skills/`) : hors des rubriques de ménage. */
function horsEntretien(f: FicheLue): boolean {
	if (f.chemin === 'SCHEMA.md' || TYPES_HORS_ENTRETIEN.has(f.fiche.type)) return true;
	return sousDossierFixe(f.chemin);
}

function sousDossierFixe(chemin: string): boolean {
	const cle = cleDeCasse(chemin);
	return Object.values(DOSSIERS_FIXES).some((d) => cle === d || cle.startsWith(`${d}/`));
}

const estFicheDeDossier = (chemin: string): boolean => positionDeFiche(chemin) !== chemin;

const extrait = (texte: string): string => {
	const net = texte.replace(/\s+/gu, ' ').trim();
	return net.length > LONGUEUR_EXTRAIT ? `${tronquerTexte(net, LONGUEUR_EXTRAIT - 1)}…` : net;
};

type FaitLu = { chemin: string; fait: Fait };

const faitsDe = (f: FicheLue): Fait[] => f.fiche.faits.flatMap((l) => ('fait' in l ? [l.fait] : []));

/** Identifiant d'une information pour agir : `chemin#^ancre`, ou le chemin et le début du texte si elle n'a pas d'ancre. */
const idDe = ({ chemin, fait }: FaitLu): string => (fait.ancre === undefined ? `${chemin} « ${extrait(fait.texte)} »` : `${chemin}#^${fait.ancre}`);

/** Mots pliés (sans casse ni accents) séparés par un espace : forme de comparaison d'un nom ou d'un titre. */
const mots = (texte: string): string => plier(texte).split(/[^\p{L}\p{N}]+/u).filter((m) => m !== '').join(' ');

/** Texte d'une information pour la comparer : liens remplacés par leur texte affiché, mots pliés. */
function texteCompare(texte: string): string {
	return mots(texte.replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/gu, (_t, cible: string, alias?: string) => alias ?? cible.split('#')[0]!.split('/').pop()!));
}

function trigrammes(texte: string): Set<string> {
	const borde = ` ${texte} `;
	const t = new Set<string>();
	for (let i = 0; i + 3 <= borde.length; i++) t.add(borde.slice(i, i + 3));
	return t;
}

function dice(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 && b.size === 0) return 1;
	let communs = 0;
	const [petit, grand] = a.size <= b.size ? [a, b] : [b, a];
	for (const t of petit) if (grand.has(t)) communs++;
	return (2 * communs) / (a.size + b.size);
}

const nombres = (texte: string): string => (texte.match(/\d+/gu) ?? []).join(' ');

type Comparable = { texte: string; nombres: string; trigrammes: Set<string> };

function comparable(texte: string): Comparable {
	const t = texteCompare(texte);
	return { texte: t, nombres: nombres(t), trigrammes: trigrammes(t) };
}

function proches(a: Comparable, b: Comparable): boolean {
	if (a.texte === '' || b.texte === '' || a.nombres !== b.nombres) return false;
	if (a.texte === b.texte) return true;
	if (Math.min(a.texte.length, b.texte.length) < RAPPORT_LONGUEUR_MIN * Math.max(a.texte.length, b.texte.length)) return false;
	return dice(a.trigrammes, b.trigrammes) >= SEUIL_DOUBLON;
}

/** Vrai si deux textes d'information sont des doublons probables : mêmes nombres et similarité au moins `SEUIL_DOUBLON`. */
export function textesProches(a: string, b: string): boolean {
	return proches(comparable(a), comparable(b));
}

type Contexte = EntreeDiagnostic & {
	entretenues: FicheLue[];
	parChemin: ReadonlyMap<string, FicheLue>;
	liens: () => Liens;
};

type Liens = {
	casses: string[];
	/** Fiches (autres qu'elle-même) qui ont un lien vers chaque fiche. */
	entrants: Map<string, Set<string>>;
	/** Fiches (autres qu'elle-même) vers lesquelles chaque fiche a un lien. */
	sortants: Map<string, Set<string>>;
};

function calculerLiens(c: EntreeDiagnostic & { parChemin: ReadonlyMap<string, FicheLue> }): Liens {
	const casses: string[] = [];
	const entrants = new Map<string, Set<string>>();
	const sortants = new Map<string, Set<string>>();
	const ancres = new Map<string, Set<string>>();
	const ancresDe = (chemin: string): Set<string> => {
		let a = ancres.get(chemin);
		if (a === undefined) {
			const f = c.parChemin.get(chemin);
			a = new Set(f === undefined ? [] : faitsDe(f).flatMap((fait) => (fait.ancre === undefined ? [] : [fait.ancre])));
			ancres.set(chemin, a);
		}
		return a;
	};
	for (const f of c.fiches) {
		const vus = new Set<string>();
		for (const { cible, suite } of liensEcrits(f.texte)) {
			if (cible.includes('://')) continue;
			const extension = extensionDe(cible.trim());
			if (extension !== null && EXTENSIONS_HORS_FICHES.has(extension)) continue;
			const ecrit = `[[${cible}${suite.split('|')[0]}]]`;
			if (vus.has(ecrit)) continue;
			vus.add(ecrit);
			const visee = c.designee(cible);
			if (visee === null) {
				casses.push(`${f.chemin} → ${ecrit}`);
				continue;
			}
			const ancre = suite.startsWith('#^') ? suite.slice(2).split('|')[0]!.trim() : null;
			if (ancre !== null && RE_ANCRE_DE_FAIT.test(ancre) && !ancresDe(visee).has(ancre)) casses.push(`${f.chemin} → ${ecrit} : ancre absente de ${visee}`);
			if (visee === f.chemin) continue;
			if (!sortants.has(f.chemin)) sortants.set(f.chemin, new Set());
			sortants.get(f.chemin)!.add(visee);
			if (!entrants.has(visee)) entrants.set(visee, new Set());
			entrants.get(visee)!.add(f.chemin);
		}
		// renvois d'une information à une autre de la même fiche
		for (const fait of faitsDe(f)) {
			for (const renvoi of [fait.invalidePar, fait.contredit]) {
				if (renvoi !== undefined && !ancresDe(f.chemin).has(renvoi)) casses.push(`${idDe({ chemin: f.chemin, fait })} : renvoi ^${renvoi} absent de la fiche`);
			}
		}
	}
	return { casses, entrants, sortants };
}

function fichesIsolees(c: Contexte): string[] {
	const { entrants, sortants } = c.liens();
	return c.entretenues
		// une source a sa rubrique ; un épisode est un journal de session, isolé par nature
		.filter((f) => f.fiche.type !== 'source' && f.fiche.type !== 'episode' && !estFicheDeDossier(f.chemin) && !entrants.has(f.chemin) && !sortants.has(f.chemin))
		.map((f) => f.chemin);
}

function sansSynthese(c: Contexte): string[] {
	return c.entretenues.filter((f) => f.fiche.type !== 'source' && !estFicheDeDossier(f.chemin) && f.fiche.synthese.trim() === '').map((f) => f.chemin);
}

/** Types de fiches rangées par Mnemo dans des dossiers d'archives (`sources/`, `episodes/<projet>/`) : ces dossiers n'ont pas à être décrits. */
const TYPES_D_ARCHIVE = new Set(['source', 'episode']);

/** Dossiers dont toutes les fiches (sous-dossiers compris, fiches de dossier exceptées) sont des sources ou des épisodes, et qui en ont. */
function dossiersDArchives(c: Contexte): Set<string> {
	const compte = new Map<string, { archives: number; autres: number }>();
	for (const f of c.fiches) {
		if (estFicheDeDossier(f.chemin)) continue;
		const archive = TYPES_D_ARCHIVE.has(f.fiche.type);
		const segments = f.chemin.split('/').slice(0, -1);
		for (let i = 1; i <= segments.length; i++) {
			const dossier = segments.slice(0, i).join('/');
			const n = compte.get(dossier) ?? { archives: 0, autres: 0 };
			if (archive) n.archives++;
			else n.autres++;
			compte.set(dossier, n);
		}
	}
	return new Set([...compte].filter(([, n]) => n.archives > 0 && n.autres === 0).map(([d]) => d));
}

function dossiers(c: Contexte): string[] {
	const parCle = new Map([...c.parChemin.values()].map((f) => [cleDeCasse(f.chemin), f]));
	const archives = dossiersDArchives(c);
	const entrees: string[] = [];
	for (const dossier of [...c.dossiers].sort(parPointsDeCode)) {
		if (sousDossierFixe(dossier) || archives.has(dossier)) continue;
		const attendue = ficheDeDossier(dossier);
		const f = parCle.get(cleDeCasse(attendue));
		if (f === undefined) entrees.push(`${dossier}/ : sans fiche (${attendue})`);
		else if (f.fiche.synthese.trim() === '') entrees.push(`${f.chemin} : synthèse vide`);
	}
	return entrees;
}

function faitsEntretenus(c: Contexte): FaitLu[] {
	return c.entretenues.flatMap((f) => faitsDe(f).map((fait) => ({ chemin: f.chemin, fait })));
}

function sousSeuil(c: Contexte): string[] {
	const seuil = Math.round(100 * c.seuilRappel);
	return faitsEntretenus(c)
		.filter(({ fait }) => !fait.barre && fait.confiance !== undefined && fait.confiance < seuil)
		.map((f) => `${idDe(f)} (confiance ${f.fait.confiance} %)`);
}

function aConfirmer(c: Contexte): string[] {
	return faitsEntretenus(c).filter(({ fait }) => !fait.barre && fait.aConfirmer).map((f) => `${idDe(f)} « ${extrait(f.fait.texte)} »`);
}

function barrees(c: Contexte): string[] {
	return faitsEntretenus(c).filter(({ fait }) => fait.barre).map((f) => `${idDe(f)} « ${extrait(f.fait.texte)} »`);
}

function doublons(c: Contexte): string[] {
	const entrees: string[] = [];
	for (const f of c.entretenues) {
		const faits = faitsDe(f)
			.filter((fait) => !fait.barre)
			.slice(0, INFORMATIONS_COMPAREES_MAX)
			.map((fait) => ({ fait, comparable: comparable(fait.texte) }));
		for (let i = 0; i < faits.length; i++) {
			for (let j = i + 1; j < faits.length; j++) {
				const a = faits[i]!;
				const b = faits[j]!;
				// une contradiction notée n'est pas un doublon : elle attend une décision
				if ((a.fait.ancre !== undefined && b.fait.contredit === a.fait.ancre) || (b.fait.ancre !== undefined && a.fait.contredit === b.fait.ancre)) continue;
				if (!proches(a.comparable, b.comparable)) continue;
				const nom = (x: Fait) => (x.ancre === undefined ? `« ${extrait(x.texte)} »` : `^${x.ancre}`);
				entrees.push(`${f.chemin} : ${nom(a.fait)} ≈ ${nom(b.fait)} (« ${extrait(a.fait.texte)} » / « ${extrait(b.fait.texte)} »)`);
			}
		}
	}
	return entrees;
}

function fichesChargees(c: Contexte): string[] {
	return c.entretenues.flatMap((f) => {
		const faits = faitsDe(f);
		if (faits.length <= SEUIL_FICHE_CHARGEE) return [];
		const barre = faits.filter((fait) => fait.barre).length;
		return [`${f.chemin} (${faits.length} informations${barre > 0 ? `, dont ${barre} barrées` : ''})`];
	});
}

function sources(c: Contexte): FicheLue[] {
	return c.fiches.filter((f) => f.fiche.type === 'source');
}

function sourcesEnDouble(c: Contexte): string[] {
	const groupes = new Map<string, string[]>();
	for (const f of sources(c)) {
		const d = descripteurDeSource(f.fiche);
		if (d === null) continue;
		const brute = f.fiche.donnees['empreinte'];
		const empreinte = c.empreintesSources.get(f.chemin) ?? (typeof brute === 'string' && brute.trim() !== '' ? brute.trim() : null) ?? d.empreinteContenu;
		if (empreinte === null) continue;
		// un fil ou une pièce jointe partage le fichier des autres : sa place dans le fichier fait partie de son corps
		const cle = [empreinte, String(d.fil ?? ''), d.piece === null ? '' : `${d.positionPiece ?? d.piece}`].join('\u0000');
		groupes.set(cle, [...(groupes.get(cle) ?? []), f.chemin]);
	}
	return [...groupes.values()].filter((g) => g.length > 1).map((g) => `${g.join(', ')} : même document`);
}

function sourcesNonCitees(c: Contexte): string[] {
	const { entrants } = c.liens();
	return sources(c)
		.filter((f) => !entrants.has(f.chemin))
		.map((f) => (f.fiche.donnees[CLE_A_TRAITER] === true ? `${f.chemin} (à traiter)` : f.chemin));
}

function categoriesRares(c: Contexte): string[] {
	const emplois = new Map<string, string[]>();
	for (const f of faitsEntretenus(c)) {
		const categorie = f.fait.categorie;
		if (categorie === undefined || f.fait.barre || c.categoriesAEnjeu.includes(categorie)) continue;
		emplois.set(categorie, [...(emplois.get(categorie) ?? []), idDe(f)]);
	}
	return [...emplois]
		.filter(([, ids]) => ids.length <= SEUIL_CATEGORIE_RARE)
		.sort(([a, x], [b, y]) => x.length - y.length || parPointsDeCode(a, b))
		.map(([categorie, ids]) => `[${categorie}] (${ids.length}) : ${ids.join(', ')}`);
}

function nomTitre(c: Contexte): string[] {
	const entrees: string[] = [];
	for (const f of c.entretenues) {
		// le nom d'une fiche de dossier est celui du dossier, par construction
		if (f.fiche.type === 'source' || f.fiche.type === 'episode' || estFicheDeDossier(f.chemin)) continue;
		const nom = mots(nomDeLaFiche(f.chemin));
		if (f.fiche.titre.trim() === '') {
			entrees.push(`${f.chemin} : sans titre`);
			continue;
		}
		if ([f.fiche.titre, ...f.fiche.alias].some((t) => mots(t) === nom)) continue;
		entrees.push(`${f.chemin} : « ${extrait(f.fiche.titre)} »`);
	}
	return entrees;
}

/**
 * Lots proposés en attente de l'utilisateur, par fiche puis par date de proposition : identifiant, genre, nombre de
 * lignes, motif ; « périmé » si la fiche a changé depuis (ou n'existe plus) : il sera refusé, à reproposer.
 */
function lotsEnAttente(c: Contexte): string[] {
	return [...(c.lots ?? [])]
		.sort((a, b) => parPointsDeCode(a.fiche, b.fiche) || a.proposeMs - b.proposeMs)
		.map((l) => {
			const f = c.parChemin.get(l.fiche);
			const perime = f === undefined || empreinte(f.texte) !== l.empreinte;
			return `${l.fiche} : lot ${l.id} (${l.genre}, ${l.lignes.length} ligne(s)) « ${extrait(l.motif)} »${perime ? ' — périmé : la fiche a changé, à reproposer' : ''}`;
		});
}

const CALCULS: Record<Rubrique, (c: Contexte) => string[]> = {
	liens_casses: (c) => c.liens().casses,
	fiches_isolees: fichesIsolees,
	sans_synthese: sansSynthese,
	dossiers,
	sous_seuil: sousSeuil,
	a_confirmer: aConfirmer,
	barrees,
	doublons,
	fiches_chargees: fichesChargees,
	sources_en_double: sourcesEnDouble,
	sources_non_citees: sourcesNonCitees,
	categories_rares: categoriesRares,
	nom_titre: nomTitre,
	lots_en_attente: lotsEnAttente,
};

/** Diagnostic des `rubriques` demandées (toutes par défaut), dans l'ordre de `RUBRIQUES` ; entrées complètes, non bornées. */
export function diagnostiquer(entree: EntreeDiagnostic, rubriques: readonly Rubrique[] = RUBRIQUES): Diagnostic {
	const fiches = [...entree.fiches].sort((a, b) => parPointsDeCode(a.chemin, b.chemin));
	const parChemin = new Map(fiches.map((f) => [f.chemin, f]));
	let liens: Liens | null = null;
	const c: Contexte = {
		...entree,
		fiches,
		parChemin,
		entretenues: fiches.filter((f) => !horsEntretien(f)),
		liens: () => (liens ??= calculerLiens({ ...entree, fiches, parChemin })),
	};
	return {
		fiches: fiches.length,
		informations: fiches.reduce((n, f) => n + faitsDe(f).length, 0),
		rubriques: RUBRIQUES.filter((r) => rubriques.includes(r)).map((rubrique) => ({ rubrique, entrees: CALCULS[rubrique](c) })),
	};
}
