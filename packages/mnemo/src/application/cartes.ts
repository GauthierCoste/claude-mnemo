/**
 * Cartes proposées à une session (spec contexte sobre § 7 et § 8) : Mnemo classe les fiches et les propose (titre, chemin,
 * première phrase, raison) au lieu de les injecter. Les cartes viennent des fiches nommées dans le message (dans l'ordre du
 * message), ou d'un classement unique par la note (`domaine/note-des-pistes.ts` : sens du message plus poids des signaux) : le
 * périmètre de la position au premier message, le périmètre restant et les voisines des fiches injectées à la main au message
 * qui en porte, la question de l'outil `contexte`. La fiche de position seule est servie entière. Avec le sens, toute carte porte
 * sa note, fiche nommée et fiche de position comprises, sans que la note les reclasse.
 */
import { fichesNommees } from '../domaine/fiches-nommees.ts';
import type { Nommable } from '../domaine/fiches-nommees.ts';
import { apportPrincipal, baseDuReranker, classer, designees, noter, signalDominant } from '../domaine/note-des-pistes.ts';
import type { Note, Signal } from '../domaine/note-des-pistes.ts';
import { deverrouiller, perimetreDe, TYPES_NON_PROPOSABLES } from '../domaine/perimetre.ts';
import type { Arete, FicheDuGraphe } from '../domaine/perimetre.ts';
import { signalInjection } from '../domaine/signal-injection.ts';
import type { InjectionManuelle } from '../domaine/signal-injection.ts';
import { estExpire } from '../domaine/elements.ts';
import type { ElementIndexe } from '../domaine/elements.ts';
import { estDocument } from '../domaine/regles.ts';
import { expressionFts } from '../domaine/requete.ts';
import { sansFaitsInactifs } from '../domaine/sans-faits-inactifs.ts';
import { normaliser } from '../domaine/sens.ts';
import { ficheDePosition } from './chercher.ts';
import { aujourdhui } from './commun.ts';
import { resolveurDeLiens } from './liens.ts';
import type { CarteJournalisee, Dependances, FicheServieLueOuEcrite, RaisonCarte, VecteurDuMessage } from './ports.ts';

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
export type DemandeCartes = {
	/** Chemin de position de la session ('' = racine). */
	position: string;
	/** Le message de l'utilisateur seul (ou la question de l'outil). */
	message: string;
	/** Vrai : proposer les cartes du périmètre. */
	perimetre: boolean;
	/** Vrai : servir la fiche de position si elle n'est pas déjà servie. */
	servirPosition: boolean;
	/** Vrai : outil `contexte` (note par le sens ou le reranker plus les signaux, ailleurs admis, au plus 10). */
	question: boolean;
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
	/** Vrai : le message part avec une fiche injectée à la main ; le périmètre restant et les voisines des injectées sont classés et proposés. */
	voisinage?: boolean;
	/** Fiches injectées entières à ce message à la demande de l'utilisateur : jamais candidates (exclues avant le plafond). */
	demandees?: readonly string[];
};
/**
 * `positionFiche` : fiche de la position si elle existe dans l'index (injectée ou non) ; null sinon : il n'y a alors pas de périmètre à proposer.
 * `vecteur` : celui du message, s'il a été calculé (jamais calculé pour lui seul).
 */
export type CartesCalculees = { position: FicheDePositionServie | null; positionFiche: string | null; cartes: Carte[]; mesure: 'reranker' | 'sens' | 'aucune'; vecteur?: VecteurDuMessage };

/** Au-delà, la fiche de position n'est plus servie entière : elle devient la première carte. */
export const TAILLE_POSITION_MAX = 8000;
const CARTES_QUESTION_MAX = 10;
const CANDIDATS_QUESTION = 40;
/** Candidates de la question soumises au reranker. */
const CANDIDATS_RERANKER = 30;
const LIGNE_MAX = 160;
/** Le reranker n'est lancé que s'il reste au moins ce temps avant l'échéance. */
const BUDGET_RERANKER_MIN_MS = 500;

const ficheDe = (id: string): string => id.split('#')[0]!;
const declareUnLieu = (e: ElementIndexe): boolean => e.dossierProjet !== null || /^(projet|client):/u.test(e.portee ?? '');

/** Synthèse d'une fiche indexée : son texte est le titre, une ligne vide, puis la synthèse. */
function syntheseDe(e: ElementIndexe | undefined): string {
	const texte = e?.texte ?? '';
	const coupe = texte.indexOf('\n\n');
	return coupe === -1 ? '' : texte.slice(coupe + 2).trim();
}

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

async function notesDuReranker(dep: Dependances, question: string, textes: readonly string[], fin: number): Promise<number[] | null> {
	const budgetMs = fin - Date.now();
	if (budgetMs < BUDGET_RERANKER_MIN_MS || textes.length === 0) return null;
	try {
		const notes = await dep.reranker.noter(question, [...textes], { budgetMs, demarrer: false, activite: { operation: 'injection' } });
		return notes === null || notes.length !== textes.length ? null : notes;
	} catch {
		return null;
	}
}

export async function calculerCartes(dep: Dependances, d: DemandeCartes): Promise<CartesCalculees> {
	const reglages = dep.reglages().contexte;
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

	const dejaVue = (chemin: string): boolean => {
		const empreinte = empreintes.get(chemin) ?? null;
		return (
			d.ecartes.includes(chemin) ||
			(d.dejaLues.has(chemin) && (d.dejaLues.get(chemin) === null || d.dejaLues.get(chemin) === empreinte)) ||
			(empreinte !== null && (d.dejaServies.get(chemin) === empreinte || d.proposees.get(chemin) === empreinte))
		);
	};
	const demandees = new Set(d.demandees ?? []);
	const jour = aujourdhui(dep);
	// une fiche périmée (`perime_le` passé) n'est plus proposée
	const proposable = (chemin: string): boolean =>
		elementDe.has(chemin) &&
		!TYPES_NON_PROPOSABLES.has(type(chemin)) &&
		!estExpire(elementDe.get(chemin)!, jour) &&
		chemin !== positionFiche &&
		!demandees.has(chemin) &&
		!dejaVue(chemin);

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
	let choisies: Choisie[] = [];
	/** Note de la fiche de position trop longue (première carte) : comme celle d'une fiche nommée, sans reclasser. */
	let noteDePosition: number | null = null;
	let mesure: CartesCalculees['mesure'] = 'aucune';
	let vecteurDuCalcul: VecteurDuMessage | null = null;
	const date = (chemin: string) => elementDe.get(chemin)?.date ?? '';

	// Note unique : sens du message (base) plus le poids de chaque signal. Un nouveau signal s'ajoute à cette liste.
	const signaux: Signal[] = [signalInjection(d.injectees ?? [], aretes, { poids: reglages.poidsInjection, demiVie: reglages.demiVieInjection })];
	const designeesParSignal = designees(signaux);
	const noterPiste = (chemin: string, base: number): Note => noter(chemin, base, signaux);
	// La raison d'une carte classée : le signal qui l'a fait monter s'il pèse plus que le sens, sinon d'où vient la candidate
	// (`origine`) ; une candidate venue seulement d'un signal (origine null) a toujours la raison de ce signal.
	// La note n'est montrée que si le sens (ou le reranker) a noté : sans modèle, la base vaut 0 et la note ne dirait rien.
	const choisie = (n: Note, origine: 'perimetre' | 'question' | null): Choisie => {
		const s = origine === null ? apportPrincipal(n) : signalDominant(n);
		const note = mesure === 'aucune' ? null : n.total;
		return s === null ? { chemin: n.chemin, raison: origine ?? 'perimetre', depuis: null, note } : { chemin: n.chemin, raison: s.signal, depuis: s.depuis, note };
	};

	if (d.question) {
		// Outil `contexte` : tout est proposable, ailleurs compris ; la note (sens plus signaux) classe, le reranker remplace le sens.
		const candidates = elements.map((e) => e.chemin).filter(proposable);
		let notes: Note[] = [];
		vecteurDuCalcul = await vecteurDuMessage(dep, d.message, d.fin);
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
			const expression = expressionFts(d.message, await dep.index.alias());
			if (expression !== null) {
				const permis = new Set(candidates);
				const trouvees = await dep.index.chercher(expression.une, { genres: ['fiche'], statuts: ['servi'], chemins: candidates }, CANDIDATS_QUESTION);
				const ordre = [...new Set(trouvees.map((e) => e.chemin))].filter((c) => permis.has(c));
				const rang = new Map(ordre.map((c, i) => [c, i]));
				notes = classer(ordre.map((c) => noterPiste(c, 0)), (a, b) => rang.get(a.chemin)! - rang.get(b.chemin)!);
			}
		}
		notes = notes.slice(0, CANDIDATS_RERANKER);
		const textes = notes.map((n) => `${titre(n.chemin)}\n${syntheseDe(elementDe.get(n.chemin))}`);
		const rerank = await notesDuReranker(dep, d.message, textes, d.fin);
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

		// Classement par la note : au premier message (périmètre) et au message qui part avec une fiche injectée à la main (périmètre
		// restant). Les fiches désignées par un signal (voisines d'une injectée) sont candidates, même d'ailleurs : le geste les désigne.
		const candidates =
			d.perimetre || d.voisinage === true
				? [...new Set([...dans, ...designeesParSignal])].filter((c) => proposable(c) && !nommeesRetenues.has(c) && c !== carteDePosition)
				: [];
		// Toute carte proposée est notée (sens du message plus poids), les fiches nommées et la fiche de position comprises :
		// la note dit la même chose partout ; seules les candidates sont classées par elle. Le vecteur du message est calculé une fois.
		const horsClassement = [...cartesNommees, ...(carteDePosition === null ? [] : [carteDePosition])];
		const aNoter = [...candidates, ...horsClassement];
		vecteurDuCalcul = aNoter.length === 0 ? null : await vecteurDuMessage(dep, d.message, d.fin);
		const sim = await similarites(dep, aNoter, vecteurDuCalcul?.valeurs ?? null, aNoter.length);
		if (sim.size > 0) mesure = 'sens';
		const noteHorsClassement = (chemin: string): number | null => (mesure === 'aucune' ? null : noterPiste(chemin, sim.get(chemin) ?? 0).total);
		// à note égale (sans modèle : poids seuls), la plus récente d'abord
		const notes = candidates.map((c) => noterPiste(c, sim.get(c) ?? 0));
		const classees = classer(notes, (a, b) => date(b.chemin).localeCompare(date(a.chemin)) || a.chemin.localeCompare(b.chemin)).slice(0, reglages.cartesPerimetre);
		choisies = [
			...classees.map((n) => choisie(n, dans.has(n.chemin) ? 'perimetre' : null)),
			...cartesNommees.map((chemin): Choisie => ({ chemin, raison: 'nommee', depuis: null, note: noteHorsClassement(chemin) })),
		];
		if (carteDePosition !== null) noteDePosition = noteHorsClassement(carteDePosition);
	}
	// la fiche de position trop longue reste la première carte
	if (carteDePosition !== null) choisies.unshift({ chemin: carteDePosition, raison: 'perimetre', depuis: null, note: noteDePosition });

	const concernees = [...choisies.map((c) => ({ chemin: c.chemin, typeFiche: type(c.chemin) })), ...(position === null ? [] : [{ chemin: position.chemin, typeFiche: type(position.chemin) }])];
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
	return { position, positionFiche, cartes, mesure, ...(vecteurDuCalcul === null ? {} : { vecteur: vecteurDuCalcul }) };
}
