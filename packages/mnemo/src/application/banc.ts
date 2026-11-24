import { plier } from '@mnemo/commun';
import { dedoublonner } from '../domaine/dedoublonner.ts';
import type { GenreElement } from '../domaine/elements.ts';
import { MOTS_VIDES, motsDe } from '../domaine/requete.ts';
import { chercherDetaille, VARIANTE_COMPLETE } from './chercher.ts';
import type { OptionsRecherche, RechercheDetaillee, Trouve, Variante } from './chercher.ts';
import type { Dependances } from './ports.ts';
import { synchroniser } from './synchroniser.ts';
import { vectoriser } from './vectoriser.ts';

/**
 * Une question du banc. `attendus` : ids d'éléments (`fiche.md#^f-0001`) ou chemins de fiche (`fiche.md` : n'importe quel
 * élément ou passage de la fiche). `genre` : `mots` (mots de la réponse), `paraphrase` (aucun mot commun), `graphe` (réponse
 * dans une fiche liée à l'évidente), `saturation` (bonne réponse noyée sous des faits sans rapport mais très sûrs),
 * `doublons` (même contenu en plusieurs copies) ; libre, il sert à ventiler les résultats. `perimetre` : dossier où
 * chercher (`Requete.perimetre`). `unSeulDe` : chemins dont au plus un peut figurer dans les 10 premiers résultats.
 */
export type Question = { question: string; attendus: string[]; position?: string; perimetre?: string; genre?: string; unSeulDe?: string[] };

/**
 * Mesure d'un ensemble de questions : réussies dans les 5 premiers, rang réciproque moyen (sur les 10 premiers) ;
 * `doublonsDans10` : entrées des 10 premiers résultats bruts (avant le dédoublonnage) qui partagent un document ou un texte
 * avec une entrée mieux classée, c'est-à-dire ce que le dédoublonnage retire (somme sur les questions) ; `egalitesEnTete` :
 * questions dont les deux premiers résultats ont le même score (signe de saturation) ; `echecsUnSeulDe` : questions à
 * `unSeulDe` dont plus d'un de ces chemins figure dans les 10 premiers résultats (dédoublonnés).
 */
export type Mesure = { presentsDans5: number; total: number; mrr: number; doublonsDans10: number; egalitesEnTete: number; echecsUnSeulDe: number };

/** Ce que les mesures de doublons et d'égalités lisent d'un résultat. */
/** `genre` : celui de l'élément ; absent, déduit de l'id (un fait a l'ancre `#^f-`, le reste compte comme une fiche). */
export type EntreeMesuree = { id: string; chemin: string; texte: string; score: number; genre?: GenreElement };

/**
 * Résultat d'une variante. `msMoyen` : durée moyenne d'une recherche ; `modelesAbsents` : modèles que la variante demande
 * mais qui n'ont pas répondu (la variante s'est faite sans eux) ; `parGenre` : mesures par genre de question, par nom trié.
 */
export type ResultatVariante = Mesure & { variante: string; msMoyen: number; modelesAbsents: string[]; parGenre: Record<string, Mesure> };

/** Variantes cumulatives du banc, dans l'ordre du rapport ; la dernière est la chaîne des outils par défaut. */
export const VARIANTES_DU_BANC: [string, Variante][] = [
	['mots', { sens: false, reranker: false, graphe: false, position: false }],
	['+ sens', { sens: true, reranker: false, graphe: false, position: false }],
	['+ reranker', { sens: true, reranker: true, graphe: false, position: false }],
	['+ graphe', { sens: true, reranker: true, graphe: true, position: false }],
	['+ position', VARIANTE_COMPLETE],
];

export const NOM_REFERENCE = 'référence sans moteur';
/** Genre d'une question qui n'en déclare pas. */
export const GENRE_PAR_DEFAUT = 'autre';

/** Résultats regardés : le rang réciproque se compte sur les 10 premiers, la réussite sur les 5 premiers. */
const LIMITE = 10;
const REUSSITE = 5;
/** Le banc mesure la qualité, pas la latence d'un outil : chaque étape a le temps de répondre. */
const BUDGET_SENS_MS = 10_000;
const BUDGET_RERANKER_MS = 15_000;
/** Mots de la référence sans moteur : au moins 3 lettres. */
const LETTRES_MIN = 3;

/** Vrai si un résultat (id, chemin de fiche) répond à l'attendu : id exact, élément de la fiche attendue, ou la fiche. */
export function correspond(attendu: string, trouve: { id: string; chemin: string }): boolean {
	return trouve.id === attendu || trouve.id.startsWith(`${attendu}#`) || trouve.chemin === attendu;
}

/** Rang (à partir de 1) du premier résultat qui répond à l'un des attendus, ou null. */
function rang(attendus: string[], trouves: { id: string; chemin: string }[]): number | null {
	const i = trouves.findIndex((t) => attendus.some((a) => correspond(a, t)));
	return i === -1 ? null : i + 1;
}

const arrondi = (x: number, decimales: number): number => Math.round(x * 10 ** decimales) / 10 ** decimales;

/** Écart de score sous lequel deux résultats sont à égalité. */
const EGALITE = 1e-9;

const genreDe = (t: EntreeMesuree): GenreElement => t.genre ?? (t.id.includes('#^f-') ? 'fait' : 'fiche');

/**
 * Entrées d'une liste (une question) que le dédoublonnage de la recherche (`domaine/dedoublonner.ts`) retirerait : même
 * document (une fiche et ses passages ; les faits d'une fiche ne comptent pas) ou même texte normalisé qu'une entrée mieux
 * classée (sauf deux faits d'une même fiche). La mesure est le dédoublonnage lui-même : elle ne peut pas s'en écarter.
 */
function doublonsDeLaListe(trouves: EntreeMesuree[]): number {
	return trouves.length - dedoublonner(trouves.map((t) => ({ id: t.id, chemin: t.chemin, genre: genreDe(t), texte: t.texte }))).length;
}

/** Doublons dans les 10 premiers, sur l'ensemble des questions (une liste de résultats classés par question). */
export function doublonsDans10(listes: EntreeMesuree[][]): number {
	return listes.reduce((somme, trouves) => somme + doublonsDeLaListe(trouves.slice(0, LIMITE)), 0);
}

/** Vrai si plus d'un des chemins `unSeulDe` de la question figure dans les 10 premiers résultats ; faux sans `unSeulDe`. */
export function echecUnSeulDe(q: Question, trouves: { chemin: string }[]): boolean {
	if (q.unSeulDe === undefined) return false;
	return new Set(trouves.slice(0, LIMITE).map((t) => t.chemin).filter((c) => q.unSeulDe!.includes(c))).size > 1;
}

/** Questions dont les deux premiers résultats ont un score égal à 1e-9 près. */
export function egalitesEnTete(listes: { score: number }[][]): number {
	return listes.filter((l) => l.length >= 2 && Math.abs(l[0]!.score - l[1]!.score) <= EGALITE).length;
}

/**
 * Mesures (globale et par genre) d'une suite de rangs, un par question, dans l'ordre des questions ; `listes` : les
 * résultats de chaque question ; `bruts` : les mêmes avant le dédoublonnage.
 */
function mesurer(
	variante: string,
	questions: Question[],
	rangs: (number | null)[],
	ms: number[],
	modelesAbsents: string[],
	listes: EntreeMesuree[][],
	bruts: EntreeMesuree[][],
): ResultatVariante {
	const mesure = (indices: number[]): Mesure => {
		const presentsDans5 = indices.filter((i) => rangs[i] !== null && rangs[i]! <= REUSSITE).length;
		const somme = indices.reduce((s, i) => s + (rangs[i] === null ? 0 : 1 / rangs[i]!), 0);
		const resultats = indices.map((i) => listes[i] ?? []);
		return {
			presentsDans5,
			total: indices.length,
			mrr: indices.length === 0 ? 0 : arrondi(somme / indices.length, 3),
			doublonsDans10: doublonsDans10(indices.map((i) => bruts[i] ?? [])),
			egalitesEnTete: egalitesEnTete(resultats),
			echecsUnSeulDe: indices.filter((i) => echecUnSeulDe(questions[i]!, listes[i] ?? [])).length,
		};
	};
	const parGenre: Record<string, Mesure> = {};
	const genres = [...new Set(questions.map((q) => q.genre ?? GENRE_PAR_DEFAUT))].sort();
	for (const genre of genres) parGenre[genre] = mesure(questions.flatMap((q, i) => ((q.genre ?? GENRE_PAR_DEFAUT) === genre ? [i] : [])));
	const msMoyen = ms.length === 0 ? 0 : Math.round(ms.reduce((s, x) => s + x, 0) / ms.length);
	return { variante, ...mesure(questions.map((_, i) => i)), msMoyen, modelesAbsents, parGenre };
}

/**
 * Modèles qui répondent (chargés au besoin, sans limite pratique de temps) : le sens après le calcul de tous les vecteurs
 * manquants, le reranker par un premier appel. Un modèle qui ne répond pas fait sauter son étape, comme en usage réel.
 */
export async function preparerModeles(dep: Dependances): Promise<{ sens: boolean; reranker: boolean }> {
	let sens = false;
	if (dep.sens.modele() !== null) {
		await vectoriser(dep, { budgetMs: Infinity, demarrer: true, compter: false });
		const essai = await dep.sens.vecteurs(['essai'], { budgetMs: BUDGET_SENS_MS, demarrer: true }).catch(() => null);
		sens = essai !== null && essai.length === 1;
	}
	const notes = await dep.reranker.noter('essai', ['essai'], { budgetMs: BUDGET_RERANKER_MS, demarrer: true }).catch(() => null);
	return { sens, reranker: notes !== null && notes.length === 1 };
}

/**
 * Pose une question à la chaîne de recherche, pour une variante, avec les modèles `disponibles` (`preparerModeles`). Un modèle
 * qui n'a pas répondu au départ est sauté (sans attendre son budget à chaque question).
 */
export async function poserQuestion(dep: Dependances, q: Question, variante: Variante, disponibles: { sens: boolean; reranker: boolean }): Promise<Trouve[]> {
	return (await poserQuestionDetaillee(dep, q, variante, disponibles)).trouves;
}

/** `poserQuestion`, avec les résultats bruts (avant le dédoublonnage). */
async function poserQuestionDetaillee(dep: Dependances, q: Question, variante: Variante, disponibles: { sens: boolean; reranker: boolean }): Promise<RechercheDetaillee> {
	const options: OptionsRecherche = {
		fin: Date.now() + BUDGET_SENS_MS + BUDGET_RERANKER_MS,
		sens: variante.sens && disponibles.sens ? { demarrer: true, similariteMin: dep.reglages().contexte.similariteRecherche } : null,
		reranker: variante.reranker && disponibles.reranker ? { demarrer: true } : null,
		sensMaxMs: BUDGET_SENS_MS,
	};
	return chercherDetaille(
		dep,
		{
			texte: q.question,
			limite: LIMITE,
			variante,
			...(q.position === undefined ? {} : { position: q.position }),
			...(q.perimetre === undefined ? {} : { perimetre: q.perimetre }),
		},
		options,
	);
}

/**
 * Pose chaque question à la chaîne de recherche, pour chaque variante (après une synchronisation et le calcul des vecteurs,
 * une fois). Une question est réussie si un attendu est dans les 5 premiers résultats ; le rang réciproque se compte sur les 10 ;
 * les doublons se comptent sur les résultats bruts, les copies en trop (`unSeulDe`) sur les résultats dédoublonnés.
 */
export async function lancerBanc(dep: Dependances, questions: Question[], variantes: [string, Variante][]): Promise<ResultatVariante[]> {
	await synchroniser(dep);
	const disponibles = await preparerModeles(dep);
	const resultats: ResultatVariante[] = [];
	for (const [nom, variante] of variantes) {
		const absents = [
			...(variante.sens && !disponibles.sens ? ['sens'] : []),
			...(variante.reranker && !disponibles.reranker ? ['reranker'] : []),
		];
		const rangs: (number | null)[] = [];
		const ms: number[] = [];
		const listes: Trouve[][] = [];
		const bruts: Trouve[][] = [];
		for (const q of questions) {
			const debut = Date.now();
			const detail = await poserQuestionDetaillee(dep, q, variante, disponibles);
			ms.push(Date.now() - debut);
			rangs.push(rang(q.attendus, detail.trouves));
			listes.push(detail.trouves);
			bruts.push(detail.bruts);
		}
		resultats.push(mesurer(nom, questions, rangs, ms, absents, listes, bruts));
	}
	return resultats;
}

/** Occurrences de `mot` dans `texte` (sous-chaînes, comme une recherche dans un éditeur). */
function occurrences(texte: string, mot: string): number {
	let n = 0;
	for (let i = texte.indexOf(mot); i !== -1; i = texte.indexOf(mot, i + mot.length)) n++;
	return n;
}

/**
 * Référence sans moteur : les mêmes fiches en Markdown, lues sans index. Les mots de la question (3 lettres ou plus, hors
 * mots vides, sans accents ni casse) sont comptés dans chaque fiche entière ; les fiches sont classées par ce compte
 * (égalité : chemin), et une question réussit si la fiche d'un attendu est dans les 5 premières. `fichiers` : chemin → Markdown.
 */
export function referenceSansMoteur(fichiers: Map<string, string>, questions: Question[]): ResultatVariante {
	const textes = [...fichiers].map(([chemin, texte]) => ({ chemin, texte: plier(texte) }));
	const rangs: (number | null)[] = [];
	const ms: number[] = [];
	for (const q of questions) {
		const debut = Date.now();
		const mots = motsDe(q.question).filter((m) => [...m].length >= LETTRES_MIN && !MOTS_VIDES.has(m));
		const classees = textes
			.map(({ chemin, texte }) => ({ chemin, compte: mots.reduce((s, m) => s + occurrences(texte, m), 0) }))
			.filter((f) => f.compte > 0)
			.sort((a, b) => b.compte - a.compte || (a.chemin < b.chemin ? -1 : a.chemin > b.chemin ? 1 : 0))
			.slice(0, LIMITE);
		const fichesAttendues = q.attendus.map((a) => a.split('#')[0]!);
		rangs.push(rang(fichesAttendues, classees.map((f) => ({ id: f.chemin, chemin: f.chemin }))));
		ms.push(Date.now() - debut);
	}
	// la référence ne rend ni score ni élément : rien à compter en doublons, égalités ni copies
	return mesurer(NOM_REFERENCE, questions, rangs, ms, [], [], []);
}

/** Toutes les fiches de la mémoire, chemin → Markdown (pour la référence sans moteur). */
export async function fichesEnMarkdown(dep: Dependances): Promise<Map<string, string>> {
	const fichiers = new Map<string, string>();
	for (const chemin of await dep.coffre.toutesLesFiches()) {
		const texte = await dep.coffre.lire(chemin);
		if (texte !== null) fichiers.set(chemin, texte);
	}
	return fichiers;
}
