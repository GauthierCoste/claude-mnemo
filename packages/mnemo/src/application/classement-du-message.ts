/**
 * Classement des candidates d'un message porteur (spec classement vivant § 3.3 et § 9.2) : quelles fiches sont candidates, leur
 * note provisoire (sens du message plus poids des signaux), leur ordre et leurs signaux bruts ; puis la forme gardée au journal.
 * Le choix des pistes et des cartes reste à `cartes.ts`.
 */
import { classer } from '../domaine/note-des-pistes.ts';
import type { Note } from '../domaine/note-des-pistes.ts';
import { estExpire } from '../domaine/elements.ts';
import type { ElementIndexe } from '../domaine/elements.ts';
import { neutres, TYPES_NON_PROPOSABLES } from '../domaine/perimetre.ts';
import type { FicheDuGraphe, Perimetre } from '../domaine/perimetre.ts';
import { expressionFts } from '../domaine/requete.ts';
import { bm25RelatifsDesListes, cosinusDesFiches, cosinusRelatif } from '../domaine/signaux-de-note.ts';
import type { SignauxBruts } from '../domaine/signaux-de-note.ts';
import type { Classe, DejaDansLaSession, Dependances, RaisonCarte } from './ports.ts';

/**
 * Une candidate classée à un message : `note` provisoire qui ordonne (sens du message plus poids des signaux ; null sans modèle du
 * sens), `p` (probabilité de la note apprise ; null tant qu'aucun modèle n'est accepté), signaux bruts, ce que la session en a
 * déjà fait (`deja`) et, si une carte la propose à ce message, sa raison (`piste` : proposée en piste, pas comme fiche nommée).
 */
export type LigneDeClassement = {
	chemin: string;
	titre: string;
	note: number | null;
	p: number | null;
	signaux: SignauxBruts;
	deja: DejaDansLaSession | null;
	raison: RaisonCarte | null;
	piste: boolean;
};

/** Lignes du classement gardées au journal par message (les 50 dernières entrées d'une session) : les mieux classées ; au-delà, coupées et comptées. */
export const CLASSEMENT_MAX = 500;

/**
 * Une fiche indexée proposable comme candidate (spec § 3.3) : d'un type proposable (ni `source`, `dossier`, `consigne`,
 * `profil`, `episode`) et non périmée (`perime_le` passé). Ce qui dépend du message (fiche de position, demandées, écartées)
 * reste à l'appelant. Le hook et le banc du contexte l'appliquent tous deux.
 */
export function ficheProposable(e: ElementIndexe | undefined, jour: string): e is ElementIndexe {
	return e !== undefined && !TYPES_NON_PROPOSABLES.has(e.typeFiche) && !estExpire(e, jour);
}

/** D'où vient une candidate : le périmètre de la position, une fiche neutre ou déverrouillée (`proche`), ou un signal seul (null). */
export type OrigineCandidate = 'perimetre' | 'proche' | null;

/**
 * Candidates d'un message (spec § 3.3) : le périmètre, les fiches neutres, les fiches d'ailleurs dont le lieu est nommé
 * (`ouvertes`), les fiches désignées par un signal (voisines d'une fiche injectée à la main, même d'ailleurs et même à la
 * racine : le geste vaut désignation). À la racine, périmètre et ailleurs sont vides : les neutres et les désignées.
 * `estCandidate` filtre (type, péremption, position, écartées…).
 */
export function candidatesDuMessage(
	perimetre: Perimetre,
	fiches: readonly FicheDuGraphe[],
	declarants: ReadonlySet<string>,
	ouvertes: ReadonlySet<string>,
	designees: ReadonlySet<string>,
	estCandidate: (chemin: string) => boolean,
): { candidates: string[]; origine: (chemin: string) => OrigineCandidate } {
	const sansLieu = neutres(fiches, perimetre, declarants);
	const deverrouillees = new Set([...ouvertes].filter((c) => perimetre.ailleurs.has(c)));
	const candidates = [...new Set([...perimetre.dans, ...sansLieu, ...deverrouillees, ...designees])].filter(estCandidate);
	const origine = (chemin: string): OrigineCandidate => (perimetre.dans.has(chemin) ? 'perimetre' : sansLieu.has(chemin) || deverrouillees.has(chemin) ? 'proche' : null);
	return { candidates, origine };
}

const ficheDe = (id: string): string => id.split('#')[0]!;

/**
 * Cosinus de chaque fiche de la mémoire avec le vecteur du message, et leur médiane (pour le cosinus relatif) : un seul parcours
 * des vecteurs, déjà en mémoire. Null sans vecteur, sans modèle ou sans aucune fiche vectorisée.
 */
async function cosinusDeLaMemoire(dep: Dependances, vecteur: Float32Array | null, nombreDeFiches: number): Promise<ReturnType<typeof cosinusDesFiches> | null> {
	const modele = dep.sens.modele();
	if (vecteur === null || modele === null || nombreDeFiches === 0) return null;
	const proches = await dep.index.plusProches(modele, vecteur, { genres: ['fiche'] }, nombreDeFiches);
	const cos = cosinusDesFiches(proches.map((p) => ({ chemin: ficheDe(p.id), similarite: p.similarite })));
	return cos.parFiche.size === 0 ? null : cos;
}

/**
 * bm25 relatif de chaque candidate (règle de `bm25Relatif`) : deux recherches plein texte sur les seules candidates, tous les mots
 * puis l'un d'eux ; 0 pour une candidate que les mots ne trouvent pas ; `ordre` : les candidates trouvées, dans l'ordre des mots.
 * Null : le message n'a aucun mot cherchable.
 */
async function bm25DesCandidates(dep: Dependances, message: string, candidates: readonly string[]): Promise<{ relatifs: Map<string, number>; ordre: string[] } | null> {
	if (candidates.length === 0 || message.trim() === '') return null;
	const expression = expressionFts(message, await dep.index.alias());
	if (expression === null) return null;
	const filtre = { genres: ['fiche' as const], statuts: ['servi' as const], chemins: [...candidates] };
	// un seul mot : les deux listes seraient la même
	const expressions = expression.toutes === expression.une ? [expression.une] : [expression.toutes, expression.une];
	const listes = [];
	for (const e of expressions) listes.push(await dep.index.chercher(e, filtre, candidates.length));
	return bm25RelatifsDesListes(listes);
}

/**
 * Un message classé : `sens` (le sens a noté), `ordre` (les candidates, de la mieux notée à la moins bien notée), `base` (le
 * cosinus ramené à 0, base de la note de toute fiche, classée ou non), `bm25` (0 : les mots ne la trouvent pas), `signaux` bruts,
 * `ordreDesMots` (les candidates que les mots trouvent, dans l'ordre du plein texte : une tête de liste du banc).
 */
export type MessageClasse = {
	sens: boolean;
	ordre: Note[];
	ordreDesMots: readonly string[];
	base(chemin: string): number;
	bm25(chemin: string): number;
	signaux(note: Note): SignauxBruts;
};

/**
 * Classe les candidates : cosinus de toute la mémoire en un parcours (vecteur du message calculé une fois, par l'appelant), bm25
 * relatif sur les candidates, note provisoire (`noter` : sens plus poids) ; à note égale (sans modèle : poids seuls), les mots,
 * puis la plus récente, puis le chemin. L'a priori des gestes n'entre que dans les signaux bruts : il ne change pas l'ordre.
 */
export async function classerLeMessage(
	dep: Dependances,
	e: {
		candidates: readonly string[];
		message: string;
		vecteur: Float32Array | null;
		nombreDeFiches: number;
		noter: (chemin: string, base: number) => Note;
		date: (chemin: string) => string;
		/** A priori des gestes de chaque fiche pour ce message (absent : 0) : un signal brut journalisé, qui ne touche pas à l'ordre. */
		aprioris?: ReadonlyMap<string, number>;
	},
): Promise<MessageClasse> {
	const cos = await cosinusDeLaMemoire(dep, e.vecteur, e.nombreDeFiches);
	const cosinus = (chemin: string): number | null => cos?.parFiche.get(chemin) ?? null;
	const base = (chemin: string): number => Math.max(0, cosinus(chemin) ?? 0);
	const mots = await bm25DesCandidates(dep, e.message, e.candidates);
	const bm25 = (chemin: string): number => mots?.relatifs.get(chemin) ?? 0;
	const notes = e.candidates.map((c) => e.noter(c, base(c)));
	const ordre = classer(notes, (a, b) => bm25(b.chemin) - bm25(a.chemin) || e.date(b.chemin).localeCompare(e.date(a.chemin)) || a.chemin.localeCompare(b.chemin));
	return {
		sens: cos !== null,
		ordre,
		ordreDesMots: mots?.ordre ?? [],
		base,
		bm25,
		signaux: (n) => ({
			cosinus: cosinus(n.chemin),
			cosinusRelatif: cosinusRelatif(cosinus(n.chemin), cos?.mediane ?? null),
			bm25Relatif: mots === null ? null : bm25(n.chemin),
			signalSession: n.apports.reduce((somme, a) => somme + a.poids, 0),
			apriori: e.aprioris?.get(n.chemin) ?? 0,
		}),
	};
}

/** Quatre décimales : assez pour l'apprentissage, et le journal reste léger. */
export function arrondi(x: number): number;
export function arrondi(x: number | null): number | null;
export function arrondi(x: number | null): number | null {
	return x === null ? null : Math.round(x * 10_000) / 10_000;
}

/**
 * Classement du journal : les `max` premières lignes (`CLASSEMENT_MAX` par défaut), rangs à partir de 1 ; la dernière gardée
 * compte les coupées. Léger : sans titre (relu dans l'index), note et signaux à 4 décimales, `p` omis tant qu'il est null.
 * `servi` : la fiche est déjà injectée dans la session.
 */
export function classementDuJournal(classement: readonly LigneDeClassement[], max = CLASSEMENT_MAX): Classe[] {
	const gardees = classement.slice(0, max);
	const coupees = classement.length - gardees.length;
	return gardees.map((l, i) => ({
		id: l.chemin,
		note: arrondi(l.note),
		servi: l.deja === 'injectee',
		rang: i + 1,
		...(l.p === null ? {} : { p: arrondi(l.p) }),
		signaux: {
			cosinus: arrondi(l.signaux.cosinus),
			cosinusRelatif: arrondi(l.signaux.cosinusRelatif),
			bm25Relatif: arrondi(l.signaux.bm25Relatif),
			signalSession: arrondi(l.signaux.signalSession),
			apriori: arrondi(l.signaux.apriori),
		},
		...(l.deja === null ? {} : { deja: l.deja }),
		...(l.piste ? { piste: true } : {}),
		...(l.raison === null ? {} : { raison: l.raison }),
		...(coupees > 0 && i === gardees.length - 1 ? { coupees } : {}),
	}));
}
