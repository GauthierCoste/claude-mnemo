/**
 * Cartes proposées à une session (spec contexte sobre § 7 et § 8, classement vivant § 3) : Mnemo classe les fiches et les propose
 * (titre, chemin, première phrase, raison) au lieu de les injecter. Les cartes viennent des fiches nommées dans le message (dans
 * l'ordre du message), ou d'un classement unique par la note (`domaine/note-des-pistes.ts` : sens du message plus poids des
 * signaux). À chaque message porteur, toutes les candidates (périmètre de la position, fiches neutres, fiches d'ailleurs dont le
 * lieu est nommé, voisines des fiches injectées à la main) sont classées (`classement-du-message.ts`) : le classement entier va
 * au journal et au panneau. Avec une note de confiance apprise (`note-du-classement.ts`, acceptée ou non), elle ordonne le
 * classement et choisit les pistes à chaque message classé (seuil des pistes) ; elle ne donne un % (`p`) que si son modèle est
 * accepté. Sans note apprise (règle provisoire), les premières nouvelles ne partent en pistes qu'au premier message et au message
 * qui part avec une fiche injectée à la main. Au hook, le reranker note les premières de l'ordre si l'estimation de sa durée
 * tient dans le temps restant (`duree-reranker.ts`) : son logit fait noter la fiche au niveau Complets. L'outil `contexte`
 * classe sur sa question, avec la même note. La fiche de position est servie entière ; au hook d'un message porteur, les
 * candidates qu'un modèle accepté met au seuil d'injection le sont aussi (`domaine/injection-automatique.ts`, spec § 3.4), au
 * message même et jamais en différé. Avec le sens, toute carte porte sa note, fiche nommée et fiche de position comprises, sans
 * que la note les reclasse.
 */
import { fichesNommees } from '../domaine/fiches-nommees.ts';
import type { Nommable } from '../domaine/fiches-nommees.ts';
import { apportPrincipal, baseDuReranker, classer, designees, noter, signalDominant } from '../domaine/note-des-pistes.ts';
import type { Note, Signal } from '../domaine/note-des-pistes.ts';
import { deverrouiller, perimetreDe, TYPES_NON_PROPOSABLES } from '../domaine/perimetre.ts';
import type { Arete, FicheDuGraphe } from '../domaine/perimetre.ts';
import { signalInjection } from '../domaine/signal-injection.ts';
import type { InjectionManuelle } from '../domaine/signal-injection.ts';
import type { ElementIndexe } from '../domaine/elements.ts';
import { estDocument } from '../domaine/regles.ts';
import { expressionFts } from '../domaine/requete.ts';
import { sansFaitsInactifs } from '../domaine/sans-faits-inactifs.ts';
import { requeteDuReranker, syntheseDuTexte, texteDuReranker as texteDeFiche } from '../domaine/textes-du-reranker.ts';
import { normaliser } from '../domaine/sens.ts';
import { noteApprise, noteDInjection, noterLaCandidate, pCalibre } from '../domaine/note-de-confiance.ts';
import type { ModelesDeNote } from '../domaine/note-de-confiance.ts';
import type { NiveauDeNote } from '../domaine/modele-de-note.ts';
import { injectables } from '../domaine/injection-automatique.ts';
import { candidatesDuMessage, classerLeMessage, ficheProposable } from './classement-du-message.ts';
import type { LigneDeClassement } from './classement-du-message.ts';
import { ficheDePosition } from './chercher.ts';
import type { DureeDuReranker } from './duree-reranker.ts';
import { aujourdhui } from './commun.ts';
import { resolveurDeLiens } from './liens.ts';
import { auSeuilDePiste, modelesActifs, noterLeClassement } from './note-du-classement.ts';
import type { CarteJournalisee, DejaDansLaSession, Dependances, FicheServieLueOuEcrite, RaisonCarte, VecteurDuMessage } from './ports.ts';

/** Fiches lues ou écrites par la session, d'après son état : chemin → empreinte de la fiche à sa lecture (null : écrite, ou inconnue). */
export function dejaLuesDe(fiches: readonly FicheServieLueOuEcrite[]): Map<string, string | null> {
	return new Map(fiches.filter((f) => f.derniereAction === 'lue' || f.derniereAction === 'ecrite').map((f) => [f.chemin, f.empreinteLue]));
}

/**
 * `empreinte` : celle de la fiche au moment où la carte est proposée (notée avec la proposition) ; `depuis` (raison `liee`) : la
 * fiche injectée à la main d'où vient le poids qui l'a fait proposer.
 */
export type Carte = {
	chemin: string;
	titre: string;
	ligne: string;
	typeFiche: string;
	raison: RaisonCarte;
	depuis: { chemin: string; titre: string } | null;
	/**
	 * Note de la piste (sens ou reranker, plus les poids des signaux) ; null sans modèle du sens. Une fiche nommée et la fiche de
	 * position trop longue sont notées comme les autres (même base, mêmes poids), sans être reclassées.
	 */
	note: number | null;
	encadree: boolean;
	empreinte: string;
};
export type FicheDePositionServie = { chemin: string; titre: string; texte: string; empreinte: string; encadree: boolean };
/** Une fiche injectée entière par Mnemo (spec classement vivant § 3.4) : sa note `p` et le niveau du modèle qui l'a notée. */
export type FicheInjecteeParMnemo = FicheDePositionServie & { p: number; niveau: NiveauDeNote };
export type DemandeCartes = {
	/** Chemin de position de la session ('' = racine). */
	position: string;
	/** Le message de l'utilisateur seul (ou la question de l'outil) : les fiches nommées s'y cherchent. */
	message: string;
	/**
	 * La requête du classement (`domaine/requete-du-message.ts`) : vecteur, mots et reranker. Absente : le message. Les fiches
	 * nommées, elles, ne se cherchent que dans le message.
	 */
	requete?: string;
	/**
	 * Le service : la durée du reranker estimée d'après ses dernières durées mesurées. Au hook, il ne note les premières
	 * candidates que si l'estimation tient dans le temps restant ; absente ou sans mesure : pas de reranker au hook.
	 */
	dureeReranker?: DureeDuReranker;
	/** Vrai : classer les candidates (message porteur, ou message qui part avec une fiche injectée à la main) : le classement va au journal et au panneau. */
	classer: boolean;
	/**
	 * Règle provisoire (aucune note apprise) : vrai si Claude reçoit des pistes (les premières nouvelles du classement), au premier
	 * message porteur (périmètre) et au message qui part avec une fiche injectée à la main (voisinage) seulement. Avec une note
	 * apprise, les pistes viennent à chaque message classé, au seuil des pistes. Les fiches nommées, elles, sont toujours proposées.
	 */
	pistes: boolean;
	/** Premier message porteur de la session (et de nouveau après /clear ou /compact) : sans le sens, le périmètre part en pistes par date. */
	premier?: boolean;
	/** Vrai : servir la fiche de position si elle n'est pas déjà servie. */
	servirPosition: boolean;
	/** Vrai : outil `contexte` (note par le sens ou le reranker plus les signaux, ailleurs admis, au plus 10). */
	question: boolean;
	/**
	 * Vrai : au hook d'un message porteur, les candidates que la note d'un modèle accepté met au seuil sont injectées entières
	 * (spec § 3.4), au message même. Jamais ailleurs : ni outil `contexte`, ni affinage, ni message muet.
	 */
	injecter?: boolean;
	/**
	 * Fiches injectées par Mnemo au message porteur précédent puis retirées faute de temps : notées à nouveau ; au seuil, injectées
	 * en priorité (dans le plafond) ; sinon, au seuil des pistes, proposées en piste hors du quota ; dessous, oubliées.
	 */
	remises?: readonly string[];
	/** Chemin → empreinte injectée (`null` : jamais injectée). */
	dejaServies: ReadonlyMap<string, string | null>;
	/** Chemin → empreinte de la fiche à sa lecture ou écriture (`null` : inconnue, la fiche compte comme vue quelle que soit sa version). */
	dejaLues: ReadonlyMap<string, string | null>;
	/** Chemin → empreinte de la fiche lors de la proposition. */
	proposees: ReadonlyMap<string, string>;
	ecartes: readonly string[];
	fin: number;
	/** Fiches injectées à la main dans la session (depuis le dernier /clear ou /compact) et leur âge en messages porteurs : poids sur leurs voisines. */
	injectees?: readonly InjectionManuelle[];
	/** Fiches injectées entières à ce message à la demande de l'utilisateur : jamais candidates (exclues avant le plafond). */
	demandees?: readonly string[];
	/**
	 * Les chemins donnés, sans les fiches écartées toujours (spec classement vivant § 4.4 : hors des candidates partout, jusqu'à
	 * leur rétablissement) : `exclusDefinitivement` de l'a priori du service, ou la liste lue dans l'état. Absent : aucune.
	 */
	exclusDefinitivement?: (chemins: readonly string[]) => string[];
	/**
	 * A priori des gestes de chaque fiche pour ce message, selon son vecteur (null : pas de vecteur) ; une fiche absente vaut 0.
	 * Journalisé dans les signaux bruts seulement : il ne change ni l'ordre ni les pistes (aucune note apprise ne l'utilise encore).
	 */
	aprioris?: (vecteur: VecteurDuMessage | null) => ReadonlyMap<string, number>;
	/** Les modèles de la note de confiance, lus une fois pour le message (`modelesActifs`) ; absents : lus ici. */
	modeles?: ModelesDeNote;
};
/**
 * `positionFiche` : fiche de la position si elle existe dans l'index (injectée ou non) ; null sinon : il n'y a alors pas de périmètre à proposer.
 * `vecteur` : celui du message, s'il a été calculé (jamais calculé pour lui seul). `classement` : toutes les candidates du message,
 * dans l'ordre (vide si rien n'a été classé : message muet sans geste, outil `contexte`).
 */
export type { LigneDeClassement };
export type CartesCalculees = {
	position: FicheDePositionServie | null;
	positionFiche: string | null;
	/** Fiches injectées entières par Mnemo à ce message (la note les met au seuil), de la mieux notée à la moins bien notée. */
	injectees: FicheInjecteeParMnemo[];
	cartes: Carte[];
	mesure: 'reranker' | 'sens' | 'aucune';
	vecteur?: VecteurDuMessage;
	classement: LigneDeClassement[];
	/** Le classement (ou, outil `contexte`, ses cartes) est noté par des modèles acceptés : `p` en % ; faux : ordre seul. */
	calibree: boolean;
	/**
	 * L'appel de mesure à lancer après la réponse du hook (`requete` pour le reranker, textes des premières de l'ordre) : le
	 * service n'a pas d'estimation fiable de la durée du reranker, et aucun appel en cours n'en donnera une. Il ne décide et
	 * n'écrit rien : sa durée seule est notée. Absent sinon.
	 */
	aMesurer?: { requete: string; textes: string[] };
};

/** Au-delà, la fiche de position n'est plus servie entière : elle devient la première carte. */
export const TAILLE_POSITION_MAX = 8000;
const CARTES_QUESTION_MAX = 10;
const CANDIDATS_QUESTION = 40;
/** Candidates de la question soumises au reranker. */
const CANDIDATS_RERANKER = 30;
const LIGNE_MAX = 160;
/**
 * Au hook, le reranker s'arrête au plus tard ce temps avant l'échéance du calcul : ce qui suit (fiches demandées, rendu,
 * écritures) a toujours son temps, et la fiche de position et les fiches demandées ne sont jamais perdues pour lui.
 */
export const RESERVE_APRES_RERANKER_MS = 45;
/**
 * Au hook, une fiche n'est plus lue pour l'injection automatique quand il reste moins que ce temps avant l'échéance du calcul :
 * les fiches demandées (lues ensuite) et les écritures gardent le leur. Une fiche qui n'a pas pu être lue reste une piste.
 */
export const RESERVE_APRES_INJECTION_MS = 20;
/** Candidates soumises à l'appel de mesure lancé après le hook quand l'estimation n'est pas fiable : celles d'un hook plein. */
const DOCUMENTS_A_MESURER = 8;

const ficheDe = (id: string): string => id.split('#')[0]!;
const declareUnLieu = (e: ElementIndexe): boolean => e.dossierProjet !== null || /^(projet|client):/u.test(e.portee ?? '');

/** Synthèse d'une fiche indexée. */
const syntheseDe = (e: ElementIndexe | undefined): string => syntheseDuTexte(e?.texte ?? '');

/** Cartes du journal (chemin, raison, fiche d'où vient le poids). */
export function cartesDuJournal(cartes: readonly Carte[]): CarteJournalisee[] {
	return cartes.map((c) => ({ chemin: c.chemin, raison: c.raison, ...(c.depuis === null ? {} : { depuis: c.depuis.chemin }), ...(c.note === null ? {} : { note: c.note }) }));
}

/** Première phrase de la synthèse, coupée à `LIGNE_MAX` caractères avec « … ». */
export function ligneDeCarte(synthese: string): string {
	const s = synthese.split('\n').map((l) => l.trim()).filter((l) => l !== '').join(' ');
	const phrase = /^.*?[.!?…](?=\s|$)/u.exec(s)?.[0] ?? s;
	const lettres = [...phrase];
	return lettres.length > LIGNE_MAX ? `${lettres.slice(0, LIGNE_MAX - 1).join('').trimEnd()}…` : phrase;
}

/** Fiches dont le contenu vient de documents : une fiche `source`, ou une fiche dont une information cite un document. */
export async function fichesAEncadrer(dep: Dependances, fiches: readonly { chemin: string; typeFiche: string }[]): Promise<Set<string>> {
	if (fiches.length === 0) return new Set();
	const faits = await dep.index.elements({ chemins: fiches.map((f) => f.chemin), genres: ['fait'] });
	// l'index ne donne un type qu'aux sources personnelles (utilisateur, session, déduction) : une autre source est un document
	const tireDUnDocument = (f: ElementIndexe) => f.source !== null && (f.typeSource === null || estDocument(f.typeSource));
	const parDocument = new Set(faits.filter(tireDUnDocument).map((f) => f.chemin));
	return new Set(fiches.filter((f) => f.typeFiche === 'source' || parDocument.has(f.chemin)).map((f) => f.chemin));
}

async function vecteurDuMessage(dep: Dependances, message: string, fin: number): Promise<VecteurDuMessage | null> {
	const budgetMs = fin - Date.now();
	const modele = dep.sens.modele();
	if (modele === null || budgetMs <= 0 || message.trim() === '') return null;
	try {
		const vecteurs = await dep.sens.vecteurs([message], { budgetMs, demarrer: false, activite: { operation: 'injection' } });
		const v = vecteurs?.length === 1 ? vecteurs[0]! : null;
		return v === null || v.length === 0 || !v.every(Number.isFinite) ? null : { modele, valeurs: normaliser(v) };
	} catch {
		return null;
	}
}

/** Similarité de sens de chaque fiche avec le vecteur (0 pour une fiche sans vecteur à jour) ; vide sans vecteur ni modèle. */
async function similarites(dep: Dependances, chemins: readonly string[], vecteur: Float32Array | null, limite: number): Promise<Map<string, number>> {
	const modele = dep.sens.modele();
	if (vecteur === null || modele === null || chemins.length === 0) return new Map();
	const proches = await dep.index.plusProches(modele, vecteur, { chemins: [...chemins], genres: ['fiche'] }, limite);
	const resultat = new Map<string, number>();
	for (const p of proches) resultat.set(ficheDe(p.id), Math.max(0, p.similarite));
	return resultat;
}

/** Notes brutes du reranker (des logits), une par texte, dans le temps qui reste ; null s'il ne répond pas (ou plus de temps). */
async function notesDuReranker(dep: Dependances, question: string, textes: readonly string[], fin: number): Promise<number[] | null> {
	const budgetMs = fin - Date.now();
	if (budgetMs <= 0 || textes.length === 0) return null;
	try {
		const notes = await dep.reranker.noter(requeteDuReranker(question), [...textes], { budgetMs, demarrer: false, activite: { operation: 'injection' } });
		return notes === null || notes.length !== textes.length ? null : notes;
	} catch {
		return null;
	}
}

/**
 * Outil `contexte` : le reranker note-t-il ses candidates ? Oui si l'estimation de sa durée (le service) tient dans le temps
 * restant ; sans estimation, s'il reste du temps : l'appel est borné par lui, et sa durée sera mesurée.
 */
function rerankerTient(duree: DureeDuReranker | undefined, documents: number, fin: number): boolean {
	const estimee = duree?.estimer(documents) ?? null;
	return estimee === null ? fin > Date.now() : estimee <= fin - Date.now();
}

/**
 * Reranker au hook (spec classement vivant § 3.6) : il note les premières candidates de l'ordre (celui de la note Sens seul si un
 * modèle est appris, sinon l'ordre provisoire), de 8 à 5 selon ce que
 * l'estimation de sa durée laisse tenir avant sa propre échéance (`fin - RESERVE_APRES_RERANKER_MS`) ; rend leurs logits bruts
 * par chemin. Vide sans estimation fiable (hook sans service, trop peu de mesures), si rien ne tient, si un autre appel du
 * reranker est en cours dans le service, ou s'il ne répond pas à temps : ni erreur, ni attente au-delà de son échéance.
 * Avec un modèle Complets appris, le logit fait noter la fiche à ce niveau ; sans, il n'est qu'un signal brut.
 */
async function logitsAuHook(
	dep: Dependances,
	duree: DureeDuReranker | undefined,
	requete: string,
	ordre: readonly string[],
	texte: (chemin: string) => string,
	fin: number,
): Promise<Map<string, number>> {
	if (duree === undefined || ordre.length === 0 || requete.trim() === '') return new Map();
	const finReranker = fin - RESERVE_APRES_RERANKER_MS;
	const k = duree.documentsAuHook(finReranker - Date.now(), ordre.length);
	if (k === null) return new Map();
	const premieres = ordre.slice(0, k);
	const notes = await notesDuReranker(dep, requete, premieres.map(texte), finReranker);
	return notes === null ? new Map() : new Map(premieres.map((c, i) => [c, notes[i]!]));
}

export async function calculerCartes(dep: Dependances, d: DemandeCartes): Promise<CartesCalculees> {
	const reglages = dep.reglages().contexte;
	const requete = d.requete ?? d.message;
	const [indexees, elements, titres, liens] = await Promise.all([
		dep.index.fiches(),
		dep.index.elements({ genres: ['fiche'] }),
		dep.index.titres(),
		dep.index.tousLesLiens(),
	]);
	const empreintes = new Map(indexees.map((f) => [f.chemin, f.empreinte]));
	const elementDe = new Map(elements.map((e) => [e.chemin, e]));
	const titreDe = new Map(titres.map((t) => [t.chemin, t.titre]));
	const titre = (chemin: string) => titreDe.get(chemin) ?? chemin;
	const type = (chemin: string) => elementDe.get(chemin)?.typeFiche ?? '';
	/** Ce que le reranker lit d'une fiche : son titre et sa synthèse (`domaine/textes-du-reranker.ts`). */
	const texteDuReranker = (chemin: string) => texteDeFiche(titre(chemin), elementDe.get(chemin)?.texte ?? '');

	const fiches: FicheDuGraphe[] = elements.map((e) => ({ chemin: e.chemin, typeFiche: e.typeFiche, declareUnLieu: declareUnLieu(e) }));
	const declarants = new Set(fiches.filter((f) => f.declareUnLieu).map((f) => f.chemin));
	const resoudre = resolveurDeLiens(titres);
	const aretes: Arete[] = [];
	for (const l of liens) {
		const vers = resoudre(l.vers);
		if (vers !== null && vers !== l.de) aretes.push({ de: l.de, vers });
	}

	// Une position dont la fiche a disparu vaut la racine.
	const ficheDePos = d.position.trim() === '' ? null : await ficheDePosition(dep, d.position);
	const positionFiche = ficheDePos !== null && elementDe.has(ficheDePos) ? ficheDePos : null;
	const { dans, ailleurs } = perimetreDe(positionFiche, fiches, aretes);

	/** Ce que la session a déjà fait de la fiche, à son empreinte actuelle (lue : quelle que soit sa version si l'empreinte lue est inconnue). */
	const dejaDe = (chemin: string): DejaDansLaSession | null => {
		const empreinte = empreintes.get(chemin) ?? null;
		if (empreinte !== null && d.dejaServies.get(chemin) === empreinte) return 'injectee';
		if (d.dejaLues.has(chemin) && (d.dejaLues.get(chemin) === null || d.dejaLues.get(chemin) === empreinte)) return 'lue';
		if (empreinte !== null && d.proposees.get(chemin) === empreinte) return 'proposee';
		return null;
	};
	const ecartees = new Set(d.ecartes);
	const dejaVue = (chemin: string): boolean => ecartees.has(chemin) || dejaDe(chemin) !== null;
	const demandees = new Set(d.demandees ?? []);
	// écartées toujours : retirées une fois de toutes les fiches, avant toute note
	const permises = d.exclusDefinitivement === undefined ? null : new Set(d.exclusDefinitivement(elements.map((e) => e.chemin)));
	const jour = aujourdhui(dep);
	// Candidate (spec classement vivant § 3.3) : indexée, d'un type proposable, non périmée (`perime_le` passé), ni la fiche de
	// position, ni demandée à ce message, ni écartée (dans la session, ou toujours). Le classement la garde même déjà injectée,
	// lue ou proposée.
	const candidate = (chemin: string): boolean =>
		ficheProposable(elementDe.get(chemin), jour) &&
		(permises === null || permises.has(chemin)) &&
		chemin !== positionFiche &&
		!demandees.has(chemin) &&
		!ecartees.has(chemin);
	/** Proposable en carte : candidate, et ni injectée, ni lue, ni proposée à son empreinte actuelle. */
	const proposable = (chemin: string): boolean => candidate(chemin) && !dejaVue(chemin);

	// Fiche de position : servie entière, sauf trop longue (première carte).
	let position: FicheDePositionServie | null = null;
	let carteDePosition: string | null = null;
	// une fiche de position écartée n'est jamais servie
	if (d.servirPosition && positionFiche !== null && !d.ecartes.includes(positionFiche) && d.dejaServies.get(positionFiche) !== (empreintes.get(positionFiche) ?? null)) {
		const brut = await dep.coffre.lire(positionFiche);
		// les faits barrés restent dans la fiche mais ne sont pas injectés
		const texte = brut === null ? null : sansFaitsInactifs(brut, jour);
		if (texte !== null) {
			if (texte.length <= TAILLE_POSITION_MAX) {
				position = { chemin: positionFiche, titre: titre(positionFiche), texte, empreinte: empreintes.get(positionFiche) ?? '', encadree: false };
				// trop longue et demandée à ce message : injectée entière parmi les fiches demandées, pas aussi en carte
			} else if (!dejaVue(positionFiche) && !demandees.has(positionFiche)) {
				carteDePosition = positionFiche;
			}
		}
	}

	type Choisie = { chemin: string; raison: RaisonCarte; depuis: string | null; note: number | null };
	let classement: LigneDeClassement[] = [];
	let choisies: Choisie[] = [];
	const injectees: FicheInjecteeParMnemo[] = [];
	/** Note de la fiche de position trop longue (première carte) : comme celle d'une fiche nommée, sans reclasser. */
	let noteDePosition: number | null = null;
	let mesure: CartesCalculees['mesure'] = 'aucune';
	let vecteurDuCalcul: VecteurDuMessage | null = null;
	let aMesurer: CartesCalculees['aMesurer'];
	let calibree = false;
	const modeles = d.modeles ?? modelesActifs(dep);
	// l'a priori des gestes n'est lu qu'avec le service : sans lui, une note qui le pèse n'est pas calibrée
	const aprioriConnu = { aprioriConnu: d.aprioris !== undefined };
	const date = (chemin: string) => elementDe.get(chemin)?.date ?? '';

	// Note unique : sens du message (base) plus le poids de chaque signal. Un nouveau signal s'ajoute à cette liste.
	const signaux: Signal[] = [signalInjection(d.injectees ?? [], aretes, { poids: reglages.poidsInjection, demiVie: reglages.demiVieInjection })];
	const designeesParSignal = designees(signaux);
	const noterPiste = (chemin: string, base: number): Note => noter(chemin, base, signaux);
	// La raison d'une carte classée : le signal qui l'a fait monter s'il pèse plus que le sens, sinon d'où vient la candidate
	// (`origine`) ; une candidate venue seulement d'un signal (origine null) a toujours la raison de ce signal.
	// La note n'est montrée que si le sens (ou le reranker) a noté : sans modèle, la base vaut 0 et la note ne dirait rien.
	// Avec une note apprise (`noteApprise`), la note de la carte est son `p` calibré (null : ordre seul, sans %).
	const choisie = (n: Note, origine: 'perimetre' | 'question' | 'proche' | null, noteApprise?: number | null): Choisie => {
		const s = origine === null ? apportPrincipal(n) : signalDominant(n);
		const note = noteApprise !== undefined ? noteApprise : mesure === 'aucune' ? null : n.total;
		return s === null ? { chemin: n.chemin, raison: origine ?? 'perimetre', depuis: null, note } : { chemin: n.chemin, raison: s.signal, depuis: s.depuis, note };
	};

	if (d.question && noteApprise(modeles)) {
		// Outil `contexte` avec une note apprise : les candidates comme sans elle (les plus proches du sens au-dessus du seuil, les
		// désignées, sinon les mots), notées par les signaux du hook (cosinus relatif à toute la mémoire, bm25 relatif, signal de
		// session) ; la note Sens seul ordonne, le reranker note les 30 premières, la note Complets les reclasse.
		const candidates = elements.map((e) => e.chemin).filter(proposable);
		vecteurDuCalcul = await vecteurDuMessage(dep, requete, d.fin);
		const aprioris = candidates.length === 0 || d.aprioris === undefined ? undefined : d.aprioris(vecteurDuCalcul);
		const m = await classerLeMessage(dep, {
			candidates,
			message: requete,
			vecteur: vecteurDuCalcul?.valeurs ?? null,
			nombreDeFiches: elements.length,
			noter: noterPiste,
			date,
			...(aprioris === undefined ? {} : { aprioris }),
		});
		if (m.sens) mesure = 'sens';
		const parChemin = new Map(m.ordre.map((n) => [n.chemin, n]));
		const cosinus = (n: Note): number | null => m.signaux(n).cosinus;
		let pool: Note[];
		if (m.sens) {
			const proches = m.ordre.filter((n) => cosinus(n) !== null).sort((a, b) => cosinus(b)! - cosinus(a)! || a.chemin.localeCompare(b.chemin)).slice(0, CANDIDATS_QUESTION);
			const dejaPris = new Set(proches.map((n) => n.chemin));
			const manquantes = m.ordre.filter((n) => designeesParSignal.has(n.chemin) && !dejaPris.has(n.chemin) && cosinus(n) !== null);
			// le seuil de sens porte sur la base : un signal fait monter une fiche proche, il ne fait pas entrer une fiche lointaine
			pool = [...proches, ...manquantes].filter((n) => n.base >= reglages.similariteRecherche);
		} else {
			pool = m.ordreDesMots.slice(0, CANDIDATS_QUESTION).flatMap((c) => (parChemin.has(c) ? [parChemin.get(c)!] : []));
		}
		const ligne = (n: Note): LigneDeClassement => ({ chemin: n.chemin, titre: titre(n.chemin), note: n.total, p: null, signaux: m.signaux(n), logit: null, deja: null, raison: null, piste: false });
		const parSens = noterLeClassement(pool.map(ligne), modeles, aprioriConnu);
		const soumises = parSens.lignes.slice(0, CANDIDATS_RERANKER);
		const rerank = rerankerTient(d.dureeReranker, soumises.length, d.fin) ? await notesDuReranker(dep, requete, soumises.map((l) => texteDuReranker(l.chemin)), d.fin) : null;
		if (rerank !== null) mesure = 'reranker';
		const logitDe = new Map(rerank === null ? [] : soumises.map((l, i) => [l.chemin, rerank[i]!] as const));
		const finale = noterLeClassement(parSens.lignes.map((l) => ({ ...l, logit: logitDe.get(l.chemin) ?? null })), modeles, aprioriConnu);
		calibree = finale.calibree;
		choisies = finale.lignes
			.slice(0, CARTES_QUESTION_MAX)
			.map((l) => choisie(parChemin.get(l.chemin)!, 'question', finale.parNote ? pCalibre(finale.notes.get(l.chemin) ?? null) : undefined));
	} else if (d.question) {
		// Outil `contexte` sans note apprise (règle provisoire) : tout est proposable, ailleurs compris ; la note (sens plus signaux)
		// classe, le reranker remplace le sens.
		const candidates = elements.map((e) => e.chemin).filter(proposable);
		let notes: Note[] = [];
		vecteurDuCalcul = await vecteurDuMessage(dep, requete, d.fin);
		const vecteur = vecteurDuCalcul?.valeurs ?? null;
		if (vecteur !== null) {
			mesure = 'sens';
			const sim = await similarites(dep, candidates, vecteur, CANDIDATS_QUESTION);
			// une fiche désignée par un signal est notée même hors des plus proches
			const manquantes = candidates.filter((c) => designeesParSignal.has(c) && !sim.has(c));
			for (const [c, s] of await similarites(dep, manquantes, vecteur, manquantes.length)) sim.set(c, s);
			// le seuil de sens porte sur la base : un signal fait monter une fiche proche, il ne fait pas entrer une fiche lointaine
			const notees = [...sim].map(([c, s]) => noterPiste(c, s)).filter((n) => n.base >= reglages.similariteRecherche);
			notes = classer(notees, (a, b) => a.chemin.localeCompare(b.chemin));
		} else {
			// sans modèle, la base vaut 0 : les poids départagent les fiches trouvées par les mots, l'ordre des mots ensuite. Seuls
			// les mots font entrer une fiche : une voisine d'une fiche injectée à la main que les mots ne trouvent pas n'est pas
			// candidate (asymétrie voulue : avec le modèle, la voisine hors des plus proches est notée, puis soumise au seuil de sens)
			const expression = expressionFts(requete, await dep.index.alias());
			if (expression !== null) {
				const permis = new Set(candidates);
				const trouvees = await dep.index.chercher(expression.une, { genres: ['fiche'], statuts: ['servi'], chemins: candidates }, CANDIDATS_QUESTION);
				const ordre = [...new Set(trouvees.map((e) => e.chemin))].filter((c) => permis.has(c));
				const rang = new Map(ordre.map((c, i) => [c, i]));
				notes = classer(ordre.map((c) => noterPiste(c, 0)), (a, b) => rang.get(a.chemin)! - rang.get(b.chemin)!);
			}
		}
		notes = notes.slice(0, CANDIDATS_RERANKER);
		const rerank = rerankerTient(d.dureeReranker, notes.length, d.fin) ? await notesDuReranker(dep, requete, notes.map((n) => texteDuReranker(n.chemin)), d.fin) : null;
		if (rerank !== null) {
			// le reranker donne la base (sa note par la sigmoïde, échelle absolue) ; les poids des signaux s'y ajoutent ; à égalité, l'ordre d'avant
			mesure = 'reranker';
			const rang = new Map(notes.map((n, i) => [n.chemin, i]));
			notes = classer(notes.map((n, i) => noterPiste(n.chemin, baseDuReranker(rerank[i]!))), (a, b) => rang.get(a.chemin)! - rang.get(b.chemin)!);
		}
		choisies = notes.slice(0, CARTES_QUESTION_MAX).map((n) => choisie(n, 'question'));
	} else {
		// Fiches nommées : une fiche d'ailleurs ne l'est que si son lieu est nommé, ou si un signal la désigne (voisine d'une fiche
		// injectée à la main) ; nommer un lieu ouvre aussi ses fiches rangées. Elles gardent l'ordre du message : la note ne les touche pas.
		const nommables: Nommable[] = titres.filter((t) => elementDe.has(t.chemin) && !TYPES_NON_PROPOSABLES.has(type(t.chemin)));
		const nommees = fichesNommees(d.message, nommables);
		const lieuxNommes = nommees.filter((c) => declarants.has(c) && ailleurs.has(c));
		const ouvertes = deverrouiller(lieuxNommes, fiches, declarants);
		const cartesNommees = nommees
			.filter((c) => (!ailleurs.has(c) || ouvertes.has(c) || designeesParSignal.has(c)) && proposable(c) && c !== carteDePosition)
			.slice(0, reglages.cartesNommees);
		const nommeesRetenues = new Set(cartesNommees);

		// Candidates (spec classement vivant § 3.3), à chaque message porteur et au message qui part avec une fiche injectée à la main.
		const { candidates, origine } = d.classer
			? candidatesDuMessage({ dans, ailleurs }, fiches, declarants, ouvertes, designeesParSignal, candidate)
			: { candidates: [] as string[], origine: () => null };
		// Toute carte proposée est notée (sens du message plus poids), les fiches nommées et la fiche de position comprises : la note
		// dit la même chose partout ; seules les candidates sont classées par elle. Le vecteur du message est calculé une fois.
		const horsClassement = [...cartesNommees, ...(carteDePosition === null ? [] : [carteDePosition])];
		const aNoter = [...candidates, ...horsClassement];
		vecteurDuCalcul = aNoter.length === 0 ? null : await vecteurDuMessage(dep, requete, d.fin);
		const aprioris = candidates.length === 0 || d.aprioris === undefined ? undefined : d.aprioris(vecteurDuCalcul);
		const m = await classerLeMessage(dep, {
			candidates,
			message: requete,
			vecteur: vecteurDuCalcul?.valeurs ?? null,
			nombreDeFiches: elements.length,
			noter: noterPiste,
			date,
			...(aprioris === undefined ? {} : { aprioris }),
		});
		if (m.sens) mesure = 'sens';
		const parChemin = new Map(m.ordre.map((n) => [n.chemin, n]));
		const ligne = (n: Note): LigneDeClassement => ({
			chemin: n.chemin,
			titre: titre(n.chemin),
			note: mesure === 'aucune' ? null : n.total,
			p: null,
			signaux: m.signaux(n),
			logit: null,
			deja: dejaDe(n.chemin),
			raison: null,
			piste: false,
		});
		// note Sens seul pour toutes les candidates, si un modèle est appris : l'ordre que suit le reranker au hook
		const parSens = noterLeClassement(m.ordre.map(ligne), modeles, aprioriConnu);
		const ordreDuHook = parSens.lignes.map((l) => l.chemin);
		// reranker au hook sur les premières de cet ordre, si l'estimation de sa durée le permet
		const logits = await logitsAuHook(dep, d.dureeReranker, requete, ordreDuHook, texteDuReranker, d.fin);
		if (logits.size === 0 && d.dureeReranker !== undefined && !d.dureeReranker.fiable() && d.dureeReranker.enCours() === 0 && m.ordre.length > 0 && requete.trim() !== '') {
			aMesurer = { requete: requeteDuReranker(requete), textes: ordreDuHook.slice(0, DOCUMENTS_A_MESURER).map(texteDuReranker) };
		}
		// note finale : Complets pour les candidates que le reranker a notées, Sens seul pour les autres
		const note = noterLeClassement(
			parSens.lignes.map((l) => ({ ...l, logit: logits.get(l.chemin) ?? null })),
			modeles,
			aprioriConnu,
		);
		calibree = note.calibree;
		// Injection automatique (spec § 3.4), au message même : les candidates qu'un modèle accepté met au seuil, non vues par la
		// session, entières, au plus `injectionsParMessage` ; une fiche trop longue, ou qu'il n'est plus temps de lire, reste une piste.
		const remises = new Set(d.remises ?? []);
		if (d.injecter === true && d.classer && reglages.injectionsParMessage > 0) {
			const vue = (chemin: string): boolean => {
				const deja = dejaDe(chemin);
				return deja === 'injectee' || deja === 'lue';
			};
			const auSeuil = injectables(note.lignes.map((l) => l.chemin), (c) => note.notes.get(c), reglages.seuilInjection, vue);
			// les fiches remises d'abord, puis les nouvelles
			for (const chemin of [...auSeuil.filter((c) => remises.has(c)), ...auSeuil.filter((c) => !remises.has(c))]) {
				if (injectees.length >= reglages.injectionsParMessage || Date.now() >= d.fin - RESERVE_APRES_INJECTION_MS) break;
				const brut = await dep.coffre.lire(chemin);
				const texte = brut === null ? null : sansFaitsInactifs(brut, jour);
				if (texte === null || texte.length > TAILLE_POSITION_MAX) continue;
				// la note qui l'a fait injecter : celle de son niveau, ou du relais si son niveau est coupé
				const n = noteDInjection(note.notes.get(chemin))!;
				injectees.push({ chemin, titre: titre(chemin), texte, empreinte: empreintes.get(chemin) ?? '', encadree: false, p: n.p, niveau: n.niveau });
			}
		}
		const injecteesIci = new Set(injectees.map((f) => f.chemin));
		/** Note d'une carte hors classement (fiche nommée, fiche de position trop longue) : comme une candidate, sans reclasser. */
		const noteHorsClassement = (chemin: string): number | null => {
			if (mesure === 'aucune') return null;
			const n = noterPiste(chemin, m.base(chemin));
			if (!note.parNote) return n.total;
			return pCalibre(note.notes.get(chemin) ?? noterLaCandidate(modeles, m.signaux(n), aprioriConnu));
		};
		let pistes: Note[];
		if (note.parNote) {
			// Une note apprise (acceptée ou non) : à chaque message classé, les nouvelles qui atteignent le seuil des pistes, dans
			// l'ordre de la note, au plus `pistesParMessage`.
			// Une fiche remise qui n'est plus injectée : en piste hors du quota, si elle atteint encore le seuil des pistes.
			const eligibles = d.classer
				? note.lignes.filter((l) => !dejaVue(l.chemin) && !injecteesIci.has(l.chemin) && !nommeesRetenues.has(l.chemin) && auSeuilDePiste(note.notes.get(l.chemin), reglages.seuilPiste))
				: [];
			pistes = [...eligibles.filter((l) => remises.has(l.chemin)), ...eligibles.filter((l) => !remises.has(l.chemin)).slice(0, reglages.pistesParMessage)].map((l) => parChemin.get(l.chemin)!);
		} else {
			// Règle provisoire (aucune note apprise, ou le sens n'a rien noté) : les premières nouvelles de l'ordre, sans seuil, seulement
			// si la demande en veut. Sans le sens, il faut que les mots trouvent la fiche ou qu'un signal la désigne : la date seule ne dit
			// rien du message ; au premier message seulement, le périmètre part par date, comme avant le classement vivant.
			const pisteEligible = (n: Note): boolean =>
				!dejaVue(n.chemin) &&
				!nommeesRetenues.has(n.chemin) &&
				(mesure !== 'aucune' || m.bm25(n.chemin) > 0 || n.apports.length > 0 || (d.premier === true && origine(n.chemin) === 'perimetre'));
			pistes = d.pistes ? m.ordre.filter(pisteEligible).slice(0, reglages.pistesParMessage) : [];
		}
		choisies = [
			...pistes.map((n) => choisie(n, origine(n.chemin), note.parNote ? pCalibre(note.notes.get(n.chemin) ?? null) : undefined)),
			// une fiche nommée injectée entière n'est pas aussi proposée en carte
			...cartesNommees.filter((chemin) => !injecteesIci.has(chemin)).map((chemin): Choisie => ({ chemin, raison: 'nommee', depuis: null, note: noteHorsClassement(chemin) })),
		];
		if (carteDePosition !== null) noteDePosition = noteHorsClassement(carteDePosition);
		const raisonDe = new Map(choisies.map((c) => [c.chemin, c.raison]));
		const enPiste = new Set(pistes.map((n) => n.chemin));
		classement = note.lignes.map((l) => ({ ...l, raison: raisonDe.get(l.chemin) ?? null, piste: enPiste.has(l.chemin), ...(injecteesIci.has(l.chemin) ? { auto: true as const } : {}) }));
	}
	// la fiche de position trop longue reste la première carte
	if (carteDePosition !== null) choisies.unshift({ chemin: carteDePosition, raison: 'perimetre', depuis: null, note: noteDePosition });

	const concernees = [
		...choisies.map((c) => ({ chemin: c.chemin, typeFiche: type(c.chemin) })),
		...injectees.map((f) => ({ chemin: f.chemin, typeFiche: type(f.chemin) })),
		...(position === null ? [] : [{ chemin: position.chemin, typeFiche: type(position.chemin) }]),
	];
	const encadrees = await fichesAEncadrer(dep, concernees);
	const cartes: Carte[] = [];
	for (const { chemin, raison, depuis, note } of choisies) {
		cartes.push({
			chemin,
			titre: titre(chemin),
			ligne: ligneDeCarte(syntheseDe(elementDe.get(chemin))),
			typeFiche: type(chemin),
			raison,
			depuis: depuis === null ? null : { chemin: depuis, titre: titre(depuis) },
			note,
			encadree: encadrees.has(chemin),
			empreinte: empreintes.get(chemin) ?? '',
		});
	}
	if (position !== null) position = { ...position, encadree: encadrees.has(position.chemin) };
	const injecteesEncadrees = injectees.map((f) => ({ ...f, encadree: encadrees.has(f.chemin) }));
	return { position, positionFiche, injectees: injecteesEncadrees, cartes, mesure, ...(vecteurDuCalcul === null ? {} : { vecteur: vecteurDuCalcul }), classement, calibree, ...(aMesurer === undefined ? {} : { aMesurer }) };
}
