import type { ElementIndexe } from './elements.ts';

export type Candidat = { element: ElementIndexe; rangs: number[] };

const K = 60;
const BONUS_GRAPHE = 1.25;
/** λ : part de ce qui manque aux mots que les listes complémentaires (sens, graphe) peuvent apporter ; réglé par le banc. */
export const POIDS_COMPLEMENTAIRE = 0.5;

/** Fusion par rangs réciproques (k = 60). `rangs[i]` : rang (1 = meilleur) dans la liste i, 0 si absent. */
export function fusionner(listes: ElementIndexe[][]): Candidat[] {
	const candidats = new Map<string, Candidat>();
	listes.forEach((liste, i) => {
		liste.forEach((element, position) => {
			let candidat = candidats.get(element.id);
			if (candidat === undefined) {
				candidat = { element, rangs: listes.map(() => 0) };
				candidats.set(element.id, candidat);
			}
			if (candidat.rangs[i] === 0) candidat.rangs[i] = position + 1;
		});
	});

	return [...candidats.values()].sort((a, b) => rrf(b.rangs) - rrf(a.rangs) || a.element.id.localeCompare(b.element.id));
}

/** `rangs[i]` : rang (1 = meilleur) dans la liste i, 0 si absent. */
export function rrf(rangs: readonly number[]): number {
	return rangs.reduce((somme, rang) => (rang > 0 ? somme + 1 / (K + rang) : somme), 0);
}

/** Apport d'une liste : (k + 1) / (k + rang), 1 au premier rang, 0 si absent. */
function apport(rang: number): number {
	return rang > 0 ? (K + 1) / (K + rang) : 0;
}

/** Part de la pertinence des mots gardée quel que soit le bm25 : `0,5 + 0,5 × r`. */
const PART_FIXE_DES_MOTS = 0.5;

/** Un candidat classé : `pertinence` (échelle du seuil de rappel), `base` (ordre fin), rang dans l'ordre du reranker. */
export type Classe = { element: ElementIndexe; pertinence: number; base: number; rangReranker: number };

/**
 * Pertinence et base de chaque candidat, triés par base décroissante, puis (entre éléments notés par le reranker) l'ordre de
 * ses notes, puis date récente, puis id. Ni voisinage, ni confiance, ni fraîcheur : ce sont les poids de la note
 * (`note-de-recherche.ts`), ajoutés par l'appelant.
 *
 * Pertinence = `Pm + (1 − Pm) × λ × Pc` (λ = `POIDS_COMPLEMENTAIRE`). `Pm` : celle des mots, comme au jalon 4 — somme des
 * 1/(k + rang) sur les listes hors `listesComplementaires`, normalisée par le nombre de ces listes qui ont répondu (au
 * moins une ; une liste vide ne plafonne pas les autres), plafonnée à 1. `Pc` : maximum, sur les listes complémentaires
 * (sens, graphe), de (k + 1)/(k + rang), 0 si absent — une liste qui ne le contient pas ne le divise pas, une seconde qui
 * le contient n'ajoute rien. Un élément du seul sens (ou du seul graphe) vaut au plus λ, le premier exactement λ.
 * `pertinences` (notes du reranker) fixe l'ORDRE des éléments notés, pas leur échelle : leurs pertinences d'avant (mots,
 * sens, graphe) sont triées puis redistribuées dans l'ordre des notes — le mieux noté reçoit la plus haute, et ainsi de
 * suite (note non finie : la dernière ; notes égales : l'ordre d'avant). L'ensemble des valeurs ne change pas : c'est la
 * pertinence que filtre le seuil de rappel, il garde donc son sens.
 *
 * Base (l'ordre) : pour un élément noté par le reranker, sa pertinence (le reranker ordonne déjà). Sinon, la part des mots
 * est modulée par le bm25 : `base = Pm × (0,5 + 0,5 × r) + (1 − Pm) × λ × Pc`, où `r` ∈ ]0, 1] est le bm25 de l'élément
 * rapporté au meilleur bm25 de sa liste de mots (la première où il figure : `toutes`, sinon `une`) ; `r = 1` sans bm25.
 * Les rangs tassent les 16 premiers entre 0,79 et 1 ; le bm25 garde l'écart entre un élément qui porte les mots précis et
 * un autre qui ne doit sa place qu'aux mots du contexte de sa fiche. La part du sens et du graphe n'est pas modulée (le
 * bm25 ne mesure que les mots). Tant que la table des notes n'est pas vide, la base d'un élément non noté est plafonnée à
 * 0,99 × la plus basse base des notés.
 */
export function classer(
	candidats: Candidat[],
	contexte: {
		pertinences?: ReadonlyMap<string, number>;
		listesComplementaires?: readonly number[];
	} = {},
): Classe[] {
	const nbListes = Math.max(0, ...candidats.map((c) => c.rangs.length));
	const complementaires = new Set(contexte.listesComplementaires ?? []);
	const repondu = (i: number) => candidats.some((c) => (c.rangs[i] ?? 0) > 0);
	let nonVides = 0;
	const complementairesNonVides: number[] = [];
	for (let i = 0; i < nbListes; i++) {
		if (!complementaires.has(i)) {
			if (repondu(i)) nonVides++;
		} else if (repondu(i)) complementairesNonVides.push(i);
	}
	const maximum = Math.max(1, nonVides) / (K + 1);
	const pms = candidats.map(({ rangs }) => Math.min(1, rrf(rangs.map((rang, i) => (complementaires.has(i) ? 0 : rang))) / maximum));
	const avant = candidats.map(({ rangs }, i) => {
		const pm = pms[i]!;
		if (complementairesNonVides.length === 0) return pm;
		const pc = Math.max(...complementairesNonVides.map((j) => apport(rangs[j] ?? 0)));
		return pm + (1 - pm) * POIDS_COMPLEMENTAIRE * pc;
	});
	const relatifs = bm25Relatifs(candidats, complementaires);
	const pertinences = [...avant];
	const notesDuReranker = contexte.pertinences ?? new Map<string, number>();
	const brutes = candidats.map(({ element }) => notesDuReranker.get(element.id));
	// une note non finie compte pour la plus basse
	const comparables = brutes.map((n) => (n !== undefined && Number.isFinite(n) ? n : -Infinity));
	const notees = candidats.flatMap((_, i) => (brutes[i] === undefined ? [] : [i]));
	/** Rang dans l'ordre du reranker (0 = le mieux noté ; Infinity : non noté). */
	const rangReranker: number[] = candidats.map(() => Infinity);
	// le reranker ordonne ; l'échelle reste celle des pertinences d'avant (mêmes valeurs, redistribuées)
	if (notees.length > 0) {
		const valeurs = notees.map((i) => avant[i]!).sort((a, b) => b - a);
		const ordre = [...notees].sort((a, b) => (comparables[a]! > comparables[b]! ? -1 : comparables[a]! < comparables[b]! ? 1 : avant[b]! - avant[a]! || a - b));
		ordre.forEach((i, k) => {
			pertinences[i] = valeurs[k]!;
			rangReranker[i] = k;
		});
	}
	const resultats: Classe[] = candidats.map(({ element }, i) => {
		const notee = brutes[i] !== undefined;
		const base = notee ? pertinences[i]! : avant[i]! - pms[i]! * (1 - PART_FIXE_DES_MOTS) * (1 - relatifs[i]!);
		return { element, pertinence: pertinences[i]!, base, rangReranker: rangReranker[i]! };
	});
	if (notees.length > 0) {
		const plafond = Math.min(...resultats.filter((c) => Number.isFinite(c.rangReranker)).map((c) => c.base)) * 0.99;
		for (const c of resultats) if (!Number.isFinite(c.rangReranker)) c.base = Math.min(c.base, plafond);
	}

	return resultats.sort(
		(a, b) =>
			b.base - a.base ||
			(Number.isFinite(a.rangReranker) && Number.isFinite(b.rangReranker) ? a.rangReranker - b.rangReranker : 0) ||
			(b.element.date ?? '').localeCompare(a.element.date ?? '') ||
			a.element.id.localeCompare(b.element.id),
	);
}

/**
 * `r` de chaque candidat : son bm25 rapporté au meilleur bm25 des candidats de la même liste de mots, celle où il figure
 * en premier (l'élément vient de cette liste : `fusionner` garde le premier vu). 1 sans liste de mots, sans bm25, ou si
 * la liste n'a aucun bm25 négatif ; 0 pour un bm25 nul ou positif dans une liste qui en a de négatifs.
 */
function bm25Relatifs(candidats: Candidat[], complementaires: ReadonlySet<number>): number[] {
	const listeDe = candidats.map(({ rangs }) => {
		const i = rangs.findIndex((rang) => rang > 0);
		return i < 0 || complementaires.has(i) ? -1 : i;
	});
	const meilleurs = new Map<number, number>();
	candidats.forEach(({ element }, k) => {
		const i = listeDe[k]!;
		const bm25 = element.bm25;
		if (i < 0 || bm25 === undefined || !(bm25 < 0)) return;
		meilleurs.set(i, Math.min(meilleurs.get(i) ?? 0, bm25));
	});
	return candidats.map(({ element }, k) => {
		const meilleur = meilleurs.get(listeDe[k]!);
		const bm25 = element.bm25;
		if (meilleur === undefined || bm25 === undefined || !Number.isFinite(bm25)) return 1;
		// un bm25 nul (ou positif) quand la liste en a de négatifs : aucun mot ne compte, r = 0
		return bm25 < 0 ? Math.min(1, bm25 / meilleur) : 0;
	});
}
