/**
 * Banc du contexte, jugement par mise en commun (spec classement vivant § 6.1) : candidates d'un message et leurs signaux
 * bruts (logit du reranker, et ceux du classement du hook : cosinus, cosinus relatif, bm25 relatif, signal de session, a priori
 * des gestes), et les têtes de liste selon le sens, les mots et le reranker, dont l'union est ce que l'on juge.
 *
 * Candidates et signaux sont ceux du classement du hook (`classement-du-message.ts` : `candidatesDuMessage`, `ficheProposable`,
 * `classerLeMessage`), pas une copie de ses règles. Ce que le banc ne peut pas reconstituer d'un message passé : les fiches
 * écartées de la session (✗ ; effacées à sa fin) ne sont pas retirées ; les écartées toujours sont celles d'aujourd'hui.
 */
import { aprioris, voixParFiche } from '../domaine/apriori-gestes.ts';
import type { GesteDApriori } from '../domaine/apriori-gestes.ts';
import { fichesNommees } from '../domaine/fiches-nommees.ts';
import type { Nommable } from '../domaine/fiches-nommees.ts';
import type { ElementIndexe } from '../domaine/elements.ts';
import { designees, noter } from '../domaine/note-des-pistes.ts';
import { deverrouiller, perimetreDe, TYPES_NON_PROPOSABLES } from '../domaine/perimetre.ts';
import type { Arete, FicheDuGraphe } from '../domaine/perimetre.ts';
import { signalInjection } from '../domaine/signal-injection.ts';
import type { InjectionManuelle } from '../domaine/signal-injection.ts';
import type { SignauxBruts } from '../domaine/signaux-de-note.ts';
import { normaliser } from '../domaine/sens.ts';
import { ligneDeCarte } from './cartes.ts';
import { ficheDePosition } from './chercher.ts';
import { candidatesDuMessage, classerLeMessage, ficheProposable } from './classement-du-message.ts';
import { aujourdhui } from './commun.ts';
import { resolveurDeLiens } from './liens.ts';
import type { Dependances, VecteurDuMessage } from './ports.ts';

/**
 * Signaux bruts d'une candidate pour une requête : ceux du classement du hook (`SignauxBruts`) et le logit du reranker (null :
 * le modèle n'a pas répondu, ou la fiche ne lui a pas été soumise). `signalSession` et `apriori` sont absents des cas extraits
 * avant qu'ils existent (lus comme 0), `cosinusZ` aussi ; `bm25Relatif` y vaut 0 quand le message n'avait pas de mots cherchables (null depuis).
 */
export type Signaux = Omit<SignauxBruts, 'signalSession' | 'apriori' | 'cosinusZ'> & { logit: number | null; signalSession?: number; apriori?: number; cosinusZ?: number | null };
export type ListeDuBanc = 'sens' | 'mots' | 'reranker';
export const LISTES_DU_BANC: readonly ListeDuBanc[] = ['sens', 'mots', 'reranker'];

/**
 * Ce que le banc lit des gestes, en lecture seule dans l'état des sessions : le journal des gestes, les fiches écartées toujours
 * (non rétablies) et le dossier de chaque session (le lieu d'un geste). Absent : l'état n'a pas encore de journal des gestes
 * (version 12 ou moins) ; l'a priori vaut alors 0 et aucune fiche n'est écartée toujours.
 */
export type GestesDuBanc = { gestes: readonly GesteDApriori[]; ecarteesToujours: ReadonlySet<string>; dossierDe: ReadonlyMap<string, string> };

/**
 * L'a priori des gestes pour un message passé, comme le hook l'aurait calculé à cet instant : les seuls gestes faits avant lui,
 * hors de sa session, au lieu de sa session (position, dossier). Undefined (a priori 0) : sans gestes, ou sans la session ou
 * l'heure du message (cas étiquetés à la main).
 */
export function aprioriDuMessage(
	g: GestesDuBanc | undefined,
	m: { session?: string; horodatageMs?: number; position: string },
	modele: string | null,
): ((vecteur: Float32Array | null) => ReadonlyMap<string, number>) | undefined {
	if (g === undefined || m.session === undefined || m.horodatageMs === undefined) return undefined;
	const avant = m.horodatageMs;
	const voix = voixParFiche(g.gestes.filter((x) => x.horodatageMs < avant));
	if (voix.size === 0) return undefined;
	const contexte = { maintenantMs: avant, sessionCourante: m.session, dossier: g.dossierDe.get(m.session) ?? null, position: m.position };
	return (vecteur) => aprioris(voix, { ...contexte, vecteur: vecteur === null || modele === null ? null : ({ modele, valeurs: vecteur } satisfies VecteurDuMessage) });
}

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
 * Candidates d'un message, par les règles du hook (`candidatesDuMessage` de `classement-du-message.ts`, spec § 3.3) : fiches
 * proposables (`ficheProposable`), ni la fiche de position, ni une fiche injectée à la main à ce message même, ni écartée
 * toujours, parmi le périmètre de la position, les fiches neutres, les fiches d'ailleurs dont le lieu est nommé et les
 * voisines des fiches injectées à la main dans la session (`injectees`, avec leur âge). Rangées par chemin.
 */
export async function candidatesDuBanc(
	dep: Dependances,
	memoire: MemoireDuBanc,
	position: string,
	message: string,
	injectees: readonly InjectionManuelle[] = [],
	ecarteesToujours: ReadonlySet<string> = new Set(),
): Promise<string[]> {
	const ficheDePos = position.trim() === '' ? null : await ficheDePosition(dep, position);
	const positionFiche = ficheDePos !== null && memoire.elementDe.has(ficheDePos) ? ficheDePos : null;
	const perimetre = perimetreDe(positionFiche, memoire.fiches, memoire.aretes);
	const nommees = fichesNommees(message, memoire.nommables);
	const lieuxNommes = nommees.filter((c) => memoire.declarants.has(c) && perimetre.ailleurs.has(c));
	const ouvertes = deverrouiller(lieuxNommes, memoire.fiches, memoire.declarants);
	const designeesParSignal = designees([signalDeSession(dep, memoire, injectees)]);
	const demandees = new Set(injectees.filter((i) => i.messages === 0).map((i) => i.chemin));
	const jour = aujourdhui(dep);
	const candidate = (chemin: string): boolean =>
		ficheProposable(memoire.elementDe.get(chemin), jour) && !ecarteesToujours.has(chemin) && chemin !== positionFiche && !demandees.has(chemin);
	return candidatesDuMessage(perimetre, memoire.fiches, memoire.declarants, ouvertes, designeesParSignal, candidate).candidates.sort();
}

/** Le signal de session du hook (voisines des fiches injectées à la main, avec leur âge), aux réglages de la mémoire. */
function signalDeSession(dep: Dependances, memoire: MemoireDuBanc, injectees: readonly InjectionManuelle[]) {
	const reglages = dep.reglages().contexte;
	return signalInjection(injectees, memoire.aretes, { poids: reglages.poidsInjection, demiVie: reglages.demiVieInjection });
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
 * Signaux bruts de chaque candidate pour `requete`, calculés par le classement du hook (`classerLeMessage` : cosinus de toute
 * la mémoire, médiane, bm25 relatif, signal de session, a priori), plus le logit du reranker ; et les `premieres` têtes selon
 * le sens (cosinus), les mots (ordre du plein texte) et le reranker (logit, sur les premières du sens et des mots).
 * `demarrer` : lancer les modèles s'ils ne tournent pas (le banc, hors du hook, le peut) ; `injectees` : fiches injectées à
 * la main dans la session (signal de session) ; `aprioris` : l'a priori des gestes selon le vecteur de la requête (absent : 0).
 */
export async function signauxDuMessage(
	dep: Dependances,
	memoire: MemoireDuBanc,
	requete: string,
	candidates: readonly string[],
	options: {
		premieres?: number;
		demarrer?: boolean;
		injectees?: readonly InjectionManuelle[];
		aprioris?: (vecteur: Float32Array | null) => ReadonlyMap<string, number>;
	} = {},
): Promise<SignauxDuMessage> {
	const premieres = options.premieres ?? PREMIERES_PAR_LISTE;
	const demarrer = options.demarrer ?? true;
	const vecteur = await vecteurDe(dep, requete, demarrer);
	const signal = signalDeSession(dep, memoire, options.injectees ?? []);
	const aprioris = candidates.length === 0 ? undefined : options.aprioris?.(vecteur);
	const m = await classerLeMessage(dep, {
		candidates,
		message: requete,
		vecteur,
		nombreDeFiches: memoire.nombreDeFiches,
		noter: (chemin, base) => noter(chemin, base, [signal]),
		date: (chemin) => memoire.elementDe.get(chemin)?.date ?? '',
		...(aprioris === undefined ? {} : { aprioris }),
	});
	const bruts = new Map(m.ordre.map((n) => [n.chemin, m.signaux(n)]));
	const cosinusDe = (c: string): number | null => bruts.get(c)?.cosinus ?? null;
	const ordreDuSens = candidates.filter((c) => cosinusDe(c) !== null).sort((a, b) => cosinusDe(b)! - cosinusDe(a)! || (a < b ? -1 : 1));
	const ordreDesMots = m.ordreDesMots;
	const soumises = [...new Set([...ordreDuSens.slice(0, SOUMISES_AU_RERANKER), ...ordreDesMots.slice(0, SOUMISES_AU_RERANKER)])];
	const logit = await logits(dep, memoire, requete, soumises, demarrer);
	const ordreDuReranker = logit === null ? [] : [...logit].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([c]) => c);
	const signaux = new Map<string, Signaux>();
	for (const c of candidates) {
		const b = bruts.get(c)!;
		signaux.set(c, { logit: logit?.get(c) ?? null, ...b });
	}
	return {
		signaux,
		tetes: { sens: ordreDuSens.slice(0, premieres), mots: ordreDesMots.slice(0, premieres), reranker: ordreDuReranker.slice(0, premieres) },
		modeles: { sens: m.sens, reranker: logit !== null },
	};
}
