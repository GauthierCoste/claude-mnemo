/**
 * Banc du contexte, jugement par mise en commun (spec classement vivant § 6.1) : candidates d'un message et leurs signaux
 * bruts (logit du reranker, cosinus, cosinus relatif, bm25 relatif), et les têtes de liste selon le sens, les mots et le
 * reranker, dont l'union est ce que l'on juge.
 *
 * À brancher après T3/T4 :
 * - les candidates (`candidatesDuBanc`) reprennent la règle de la spec § 3.3 (périmètre, neutres, fiches d'ailleurs dont le lieu
 *   est nommé, voisines des fiches injectées à la main) ; T3 la porte dans `cartes.ts` (et `neutres` dans `domaine/perimetre.ts`) : le banc prendra alors la sienne ;
 * - le bm25 relatif suit la règle de `bm25Relatifs` (`domaine/classement.ts`), que T4 exporte ; le banc l'appellera alors.
 */
import { fichesNommees } from '../domaine/fiches-nommees.ts';
import type { Nommable } from '../domaine/fiches-nommees.ts';
import { estExpire } from '../domaine/elements.ts';
import type { ElementIndexe } from '../domaine/elements.ts';
import { deverrouiller, lieuDeclare, perimetreDe, TYPES_NON_PROPOSABLES } from '../domaine/perimetre.ts';
import type { Arete, FicheDuGraphe } from '../domaine/perimetre.ts';
import { signalInjection } from '../domaine/signal-injection.ts';
import type { InjectionManuelle } from '../domaine/signal-injection.ts';
import { expressionFts } from '../domaine/requete.ts';
import { normaliser } from '../domaine/sens.ts';
import { ligneDeCarte } from './cartes.ts';
import { ficheDePosition } from './chercher.ts';
import { aujourdhui } from './commun.ts';
import { resolveurDeLiens } from './liens.ts';
import type { Dependances } from './ports.ts';

/** Signaux bruts d'une candidate pour une requête ; null : le modèle n'a pas répondu (ou, pour le logit, la fiche n'a pas été soumise au reranker). */
export type Signaux = { logit: number | null; cosinus: number | null; cosinusRelatif: number | null; bm25Relatif: number };
export type ListeDuBanc = 'sens' | 'mots' | 'reranker';
export const LISTES_DU_BANC: readonly ListeDuBanc[] = ['sens', 'mots', 'reranker'];

/** Ce que le banc lit une fois de la mémoire, pour tous les messages. */
export type MemoireDuBanc = {
	elementDe: ReadonlyMap<string, ElementIndexe>;
	titreDe: ReadonlyMap<string, string>;
	fiches: readonly FicheDuGraphe[];
	aretes: readonly Arete[];
	declarants: ReadonlySet<string>;
	nommables: readonly Nommable[];
	alias: Map<string, string[]>;
	/** Nombre de fiches de la mémoire (le cosinus relatif se rapporte à toutes). */
	nombreDeFiches: number;
	/** Empreinte de chaque fiche indexée (identité de ce que l'on juge). */
	empreinteDe: ReadonlyMap<string, string>;
};

/** Premières de chaque liste mises en commun (spec : 10 à 15). */
export const PREMIERES_PAR_LISTE = 10;
/** Candidates soumises au reranker : les premières du sens et des mots (comme les 30 de l'outil `contexte`). */
const SOUMISES_AU_RERANKER = 30;
/** Le banc donne aux modèles tout le temps qu'il leur faut (comme `mnemo banc`) : il mesure la qualité, pas le budget. */
const BUDGET_SENS_MS = 10_000;
const BUDGET_RERANKER_MS = 15_000;

const ficheDe = (id: string): string => id.split('#')[0]!;
const declareUnLieu = (e: ElementIndexe): boolean => e.dossierProjet !== null || /^(projet|client):/u.test(e.portee ?? '');

/** Synthèse d'une fiche indexée : son texte est le titre, une ligne vide, puis la synthèse (comme `cartes.ts`). */
export function syntheseDe(e: ElementIndexe | undefined): string {
	const texte = e?.texte ?? '';
	const coupe = texte.indexOf('\n\n');
	return coupe === -1 ? '' : texte.slice(coupe + 2).trim();
}

export async function chargerMemoireDuBanc(dep: Dependances): Promise<MemoireDuBanc> {
	const [elements, titres, liens, alias, indexees] = await Promise.all([
		dep.index.elements({ genres: ['fiche'] }),
		dep.index.titres(),
		dep.index.tousLesLiens(),
		dep.index.alias(),
		dep.index.fiches(),
	]);
	const elementDe = new Map(elements.map((e) => [e.chemin, e]));
	const fiches: FicheDuGraphe[] = elements.map((e) => ({ chemin: e.chemin, typeFiche: e.typeFiche, declareUnLieu: declareUnLieu(e) }));
	const resoudre = resolveurDeLiens(titres);
	const aretes: Arete[] = [];
	for (const l of liens) {
		const vers = resoudre(l.vers);
		if (vers !== null && vers !== l.de) aretes.push({ de: l.de, vers });
	}
	const type = (chemin: string) => elementDe.get(chemin)?.typeFiche ?? '';
	return {
		elementDe,
		titreDe: new Map(titres.map((t) => [t.chemin, t.titre])),
		fiches,
		aretes,
		declarants: new Set(fiches.filter((f) => f.declareUnLieu).map((f) => f.chemin)),
		nommables: titres.filter((t) => elementDe.has(t.chemin) && !TYPES_NON_PROPOSABLES.has(type(t.chemin))),
		alias,
		nombreDeFiches: elements.length,
		empreinteDe: new Map(indexees.map((f) => [f.chemin, f.empreinte])),
	};
}

/** Titre et première ligne de la synthèse d'une fiche, pour la juger. */
export function presentationDe(memoire: MemoireDuBanc, chemin: string): { titre: string; ligne: string } {
	return { titre: memoire.titreDe.get(chemin) ?? chemin, ligne: ligneDeCarte(syntheseDe(memoire.elementDe.get(chemin))) };
}

/**
 * Candidates d'un message (spec § 3.3) : fiches proposables (ni `source`, `dossier`, `consigne`, `profil`, `episode`, ni
 * périmées, ni la fiche de position, ni une fiche injectée à la main à ce message même) parmi le périmètre de la position, les
 * fiches neutres (sans lieu déclaré, ni du périmètre ni d'ailleurs), les fiches d'ailleurs dont le lieu est nommé dans le
 * message et les voisines des fiches injectées à la main dans la session (signal de session, `injectees` avec leur âge). À la
 * racine : les neutres et ces voisines. À remplacer par les candidates de T3 (`cartes.ts`) une fois livrées.
 */
export async function candidatesDuBanc(dep: Dependances, memoire: MemoireDuBanc, position: string, message: string, injectees: readonly InjectionManuelle[] = []): Promise<string[]> {
	const ficheDePos = position.trim() === '' ? null : await ficheDePosition(dep, position);
	const positionFiche = ficheDePos !== null && memoire.elementDe.has(ficheDePos) ? ficheDePos : null;
	const { dans, ailleurs } = perimetreDe(positionFiche, memoire.fiches, memoire.aretes);
	const neutres = memoire.fiches.filter((f) => !dans.has(f.chemin) && !ailleurs.has(f.chemin) && lieuDeclare(f.chemin, memoire.declarants) === null).map((f) => f.chemin);
	const nommees = positionFiche === null ? [] : fichesNommees(message, memoire.nommables);
	const lieuxNommes = nommees.filter((c) => memoire.declarants.has(c) && ailleurs.has(c));
	const ouvertes = [...deverrouiller(lieuxNommes, memoire.fiches, memoire.declarants)].filter((c) => ailleurs.has(c));
	const reglages = dep.reglages().contexte;
	const designees = signalInjection(injectees, memoire.aretes, { poids: reglages.poidsInjection, demiVie: reglages.demiVieInjection }).designees;
	const demandees = new Set(injectees.filter((i) => i.messages === 0).map((i) => i.chemin));
	const jour = aujourdhui(dep);
	const proposable = (chemin: string): boolean => {
		const e = memoire.elementDe.get(chemin);
		return e !== undefined && !TYPES_NON_PROPOSABLES.has(e.typeFiche) && !estExpire(e, jour) && chemin !== positionFiche && !demandees.has(chemin);
	};
	return [...new Set([...dans, ...neutres, ...ouvertes, ...designees])].filter(proposable).sort();
}

/**
 * Modèles disponibles pour le banc : le sens s'il rend un vecteur et que l'index a des vecteurs de ce modèle, le reranker s'il
 * note. Un modèle disponible qui ne répond pas à un message fait laisser ce message (il sera repris à la prochaine extraction).
 */
export async function modelesDisponibles(dep: Dependances, demarrer = true): Promise<{ sens: boolean; reranker: boolean }> {
	const modele = dep.sens.modele();
	const vecteur = modele === null ? null : await vecteurDe(dep, 'essai', demarrer);
	const sens = vecteur !== null && modele !== null && (await dep.index.nombreVecteurs(modele)) > 0;
	const notes = await dep.reranker.noter('essai', ['essai'], { budgetMs: BUDGET_RERANKER_MS, demarrer, activite: { operation: 'recherche' } }).catch(() => null);
	return { sens, reranker: notes !== null && notes.length === 1 };
}

/** Signaux de toutes les candidates pour une requête, les têtes de chaque liste et les modèles qui ont répondu. */
export type SignauxDuMessage = {
	signaux: Map<string, Signaux>;
	tetes: Record<ListeDuBanc, string[]>;
	modeles: { sens: boolean; reranker: boolean };
};

async function vecteurDe(dep: Dependances, requete: string, demarrer: boolean): Promise<Float32Array | null> {
	if (dep.sens.modele() === null || requete.trim() === '') return null;
	try {
		const vecteurs = await dep.sens.vecteurs([requete], { budgetMs: BUDGET_SENS_MS, demarrer, activite: { operation: 'recherche' } });
		const v = vecteurs?.length === 1 ? vecteurs[0]! : null;
		return v === null || v.length === 0 || !v.every(Number.isFinite) ? null : normaliser(v);
	} catch {
		return null;
	}
}

const mediane = (valeurs: readonly number[]): number => {
	const triees = [...valeurs].sort((a, b) => a - b);
	const m = Math.floor(triees.length / 2);
	return triees.length % 2 === 1 ? triees[m]! : (triees[m - 1]! + triees[m]!) / 2;
};

/** Cosinus de chaque fiche de la mémoire avec la requête, et leur médiane ; null sans modèle ou sans vecteur. */
async function cosinus(dep: Dependances, memoire: MemoireDuBanc, vecteur: Float32Array | null): Promise<{ parFiche: Map<string, number>; mediane: number } | null> {
	const modele = dep.sens.modele();
	if (vecteur === null || modele === null || memoire.nombreDeFiches === 0) return null;
	const proches = await dep.index.plusProches(modele, vecteur, { genres: ['fiche'] }, memoire.nombreDeFiches);
	if (proches.length === 0) return null;
	const parFiche = new Map<string, number>();
	for (const p of proches) if (!parFiche.has(ficheDe(p.id))) parFiche.set(ficheDe(p.id), p.similarite);
	return { parFiche, mediane: mediane([...parFiche.values()]) };
}

/**
 * bm25 relatif de chaque candidate (règle de `bm25Relatifs`, `domaine/classement.ts`) : son bm25 rapporté au meilleur de la
 * liste de mots où elle paraît d'abord (tous les mots, sinon l'un d'eux) ; 1 si la liste n'a aucun bm25 négatif ; 0 pour une
 * fiche que les mots ne trouvent pas. `ordre` : les fiches trouvées, dans l'ordre des mots.
 */
async function mots(dep: Dependances, memoire: MemoireDuBanc, requete: string, candidates: readonly string[]): Promise<{ relatifs: Map<string, number>; ordre: string[] }> {
	const relatifs = new Map<string, number>();
	const ordre: string[] = [];
	const expression = expressionFts(requete, memoire.alias);
	if (expression === null || candidates.length === 0) return { relatifs, ordre };
	for (const liste of [expression.toutes, expression.une]) {
		const trouvees = await dep.index.chercher(liste, { genres: ['fiche'], statuts: ['servi'], chemins: [...candidates] }, candidates.length);
		const meilleur = Math.min(0, ...trouvees.map((e) => (e.bm25 !== undefined && Number.isFinite(e.bm25) ? e.bm25 : 0)));
		for (const e of trouvees) {
			if (relatifs.has(e.chemin)) continue;
			const bm25 = e.bm25;
			relatifs.set(e.chemin, meilleur === 0 || bm25 === undefined || !Number.isFinite(bm25) ? 1 : bm25 < 0 ? Math.min(1, bm25 / meilleur) : 0);
			ordre.push(e.chemin);
		}
	}
	return { relatifs, ordre };
}

async function logits(dep: Dependances, memoire: MemoireDuBanc, requete: string, chemins: readonly string[], demarrer: boolean): Promise<Map<string, number> | null> {
	if (chemins.length === 0) return new Map();
	const textes = chemins.map((c) => `${memoire.titreDe.get(c) ?? c}\n${syntheseDe(memoire.elementDe.get(c))}`);
	try {
		const notes = await dep.reranker.noter(requete, textes, { budgetMs: BUDGET_RERANKER_MS, demarrer, activite: { operation: 'recherche' } });
		if (notes === null || notes.length !== chemins.length) return null;
		return new Map(chemins.map((c, i) => [c, notes[i]!]));
	} catch {
		return null;
	}
}

/**
 * Signaux bruts de chaque candidate pour `requete`, et les `premieres` têtes selon le sens (cosinus), les mots (ordre du
 * plein texte) et le reranker (logit, sur les premières du sens et des mots). `demarrer` : lancer les modèles s'ils ne
 * tournent pas (le banc, hors du hook, le peut).
 */
export async function signauxDuMessage(
	dep: Dependances,
	memoire: MemoireDuBanc,
	requete: string,
	candidates: readonly string[],
	options: { premieres?: number; demarrer?: boolean } = {},
): Promise<SignauxDuMessage> {
	const premieres = options.premieres ?? PREMIERES_PAR_LISTE;
	const demarrer = options.demarrer ?? true;
	const cos = await cosinus(dep, memoire, await vecteurDe(dep, requete, demarrer));
	const { relatifs, ordre: ordreDesMots } = await mots(dep, memoire, requete, candidates);
	const ordreDuSens =
		cos === null ? [] : candidates.filter((c) => cos.parFiche.has(c)).sort((a, b) => cos.parFiche.get(b)! - cos.parFiche.get(a)! || (a < b ? -1 : 1));
	const soumises = [...new Set([...ordreDuSens.slice(0, SOUMISES_AU_RERANKER), ...ordreDesMots.slice(0, SOUMISES_AU_RERANKER)])];
	const logit = await logits(dep, memoire, requete, soumises, demarrer);
	const ordreDuReranker = logit === null ? [] : [...logit].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([c]) => c);
	const signaux = new Map<string, Signaux>();
	for (const c of candidates) {
		const cosinusDe = cos?.parFiche.get(c) ?? null;
		signaux.set(c, {
			logit: logit?.get(c) ?? null,
			cosinus: cosinusDe,
			cosinusRelatif: cosinusDe === null || cos === null ? null : cosinusDe - cos.mediane,
			bm25Relatif: relatifs.get(c) ?? 0,
		});
	}
	return {
		signaux,
		tetes: { sens: ordreDuSens.slice(0, premieres), mots: ordreDesMots.slice(0, premieres), reranker: ordreDuReranker.slice(0, premieres) },
		modeles: { sens: cos !== null, reranker: logit !== null },
	};
}
