// Note de confiance d'une candidate (spec classement vivant § 4.2) : `p = σ(z)`, `z = biais + Σ poids·variable`, d'après ses
// signaux bruts et le modèle de son niveau, avec les conventions de l'apprentissage (`variablesDeNote` : bm25 relatif null = 0,
// signal de session ou a priori absent = 0, cosinus relatif null : pas de note). `p_sans_apriori` : le même `z` sans le terme
// de l'a priori. Pur.
//
// Trois régimes (décisions du 25/11) : un modèle **accepté** donne `p` (un %, calibré) ; un modèle **appris mais refusé** (critères
// manqués, ou appris pour d'autres fichiers GGUF que ceux installés) ordonne le classement et choisit les pistes par sa note, sans
// % ni injection ; **aucun modèle appris** : la règle provisoire (ordre par le sens et les poids des signaux). Un modèle **de
// départ** (livré avec Mnemo, appris ailleurs : décision D2 du 26/11) est dans le régime du refusé, sous son propre état.

import { memeEchelle, variablesDeNote, VARIABLES_DU_NIVEAU } from './modele-de-note.ts';
import type { CoefficientsNote, EchelleDesSignaux, IdentiteDesModeles, ModeleDeNote, NiveauDeNote, SignauxDeNote } from './modele-de-note.ts';
import { sigmoide } from './regression-logistique.ts';

/**
 * Un modèle accepté et utilisable ; appris mais refusé (ou d'autres GGUF) ; de départ (livré avec Mnemo, pas appris sur la
 * mémoire : comme refusé, il ordonne sans % ni injection) ; accepté mais coupé par le suivi des injections (`suivi-injection.ts` :
 * trop d'écarts ; ses % et son ordre restent, seule l'injection automatique s'arrête) ; jamais appris.
 */
export type EtatDuModele = 'accepte' | 'refuse' | 'depart' | 'coupe' | 'non_appris';

/**
 * Le modèle a-t-il été appris pour d'autres fichiers GGUF que ceux installés ? Le Sens seul ne compare que celui du sens, le
 * Complets ceux du sens et du reranker ; un fichier inconnu d'un côté ne compte pas.
 */
function autresGguf(m: ModeleDeNote, niveau: NiveauDeNote, installes: IdentiteDesModeles): boolean {
	const differe = (a: string | null, b: string | null) => a !== null && b !== null && a !== b;
	return differe(m.gguf.sens, installes.sens) || (niveau === 'complets' && differe(m.gguf.reranker, installes.reranker));
}

/**
 * État d'un modèle pour les modèles installés et l'échelle actuelle des signaux : jamais appris (aucune date ou aucun poids) ;
 * de départ (`origine` `depart`), quels que soient les GGUF et l'échelle (il n'en a pas) ; refusé s'il n'a pas passé l'acceptation, s'il a été appris pour d'autres fichiers GGUF que ceux installés, ou avec une autre
 * échelle des signaux (réglages du signal de session, constantes de l'a priori) ; accepté sinon.
 */
export function etatDuModele(m: ModeleDeNote, niveau: NiveauDeNote, installes: IdentiteDesModeles, echelle: EchelleDesSignaux): EtatDuModele {
	if (m.apprisLe === null || Object.keys(m.poids).length === 0) return 'non_appris';
	if (m.origine === 'depart') return 'depart';
	return m.accepte && !autresGguf(m, niveau, installes) && memeEchelle(m.echelle, echelle) ? 'accepte' : 'refuse';
}

/** `z` d'une candidate et son `z` sans l'a priori ; null si une variable du niveau manque (cosinus relatif, logit au niveau Complets). */
export function margesDeNote(m: Pick<ModeleDeNote, 'biais' | 'poids' | 'methodeCosinus'>, niveau: NiveauDeNote, s: SignauxDeNote): { z: number; zSansApriori: number } | null {
	const x = variablesDeNote(niveau, s, m.methodeCosinus);
	if (x === null) return null;
	let z = m.biais;
	let apriori = 0;
	VARIABLES_DU_NIVEAU[niveau].forEach((v, j) => {
		const terme = (m.poids[v] ?? 0) * x[j]!;
		z += terme;
		if (v === 'apriori') apriori = terme;
	});
	return Number.isFinite(z) ? { z, zSansApriori: z - apriori } : null;
}

/** `p` et `p_sans_apriori` d'une candidate par le modèle d'un niveau ; null si une variable manque. */
export function noteDeConfiance(m: Pick<ModeleDeNote, 'biais' | 'poids' | 'methodeCosinus'>, niveau: NiveauDeNote, s: SignauxDeNote): { p: number; pSansApriori: number } | null {
	const z = margesDeNote(m, niveau, s);
	return z === null ? null : { p: sigmoide(z.z), pSansApriori: sigmoide(z.zSansApriori) };
}

/** Les modèles des deux niveaux, chacun avec son état pour les modèles installés. */
export type ModelesDeNote = Record<NiveauDeNote, { modele: ModeleDeNote; etat: EtatDuModele }>;

/**
 * Les modèles et leur état. Garde-fou : un Complets appris pour une autre variante de requête que le Sens seul (qui ordonne
 * les candidates qu'il note) est refusé.
 */
export function modelesDeNote(c: CoefficientsNote, installes: IdentiteDesModeles, echelle: EchelleDesSignaux): ModelesDeNote {
	const sens = etatDuModele(c.sens, 'sens', installes, echelle);
	let complets = etatDuModele(c.complets, 'complets', installes, echelle);
	if (complets === 'accepte' && sens !== 'non_appris' && c.complets.requete !== c.sens.requete) complets = 'refuse';
	return { complets: { modele: c.complets, etat: complets }, sens: { modele: c.sens, etat: sens } };
}

/** Vrai si au moins un niveau a un modèle appris (accepté, refusé ou de départ) : sa note ordonne ; sinon, la règle provisoire. */
export function noteApprise(m: ModelesDeNote): boolean {
	return m.complets.etat !== 'non_appris' || m.sens.etat !== 'non_appris';
}

/**
 * La note d'une candidate : `p` et `p_sans_apriori` du niveau qui la note, et si elle est calibrée (`accepte` : `p` est un %,
 * utilisable pour l'injection). Niveau Complets pour une candidate notée par le reranker (`logit`), si son modèle est appris et
 * que ses variables sont là, et s'il est accepté ou que le Sens seul ne l'est pas (un Complets refusé ne remplace pas un Sens
 * seul accepté : le logit est alors seulement journalisé) ; sinon Sens seul, si son modèle est appris. Null : aucun modèle
 * appris ne la note (cosinus absent, ou aucun modèle du niveau).
 * `aprioriConnu` faux (l'a priori des gestes n'a pas été lu : hook sans service) : une note dont le modèle pèse l'a priori n'est
 * pas calibrée (elle ordonne, sans %).
 */
export type NoteDeLaCandidate = {
	p: number;
	pSansApriori: number;
	niveau: NiveauDeNote;
	accepte: boolean;
	coupee?: true;
	/** Note d'un modèle de départ (jamais calibrée). */
	depart?: true;
	/**
	 * Niveau coupé par le suivi : la note du niveau suivant (Sens seul) s'il est accepté et pas coupé ; c'est elle qui décide de
	 * l'injection automatique (le % affiché et l'ordre restent ceux du niveau coupé).
	 */
	relais?: NoteDeLaCandidate;
};

/** Un modèle qui donne des % : accepté, coupé par le suivi compris (la coupure n'arrête que l'injection automatique). */
const calibre = (etat: EtatDuModele): boolean => etat === 'accepte' || etat === 'coupe';

export function noterLaCandidate(m: ModelesDeNote, s: SignauxDeNote, options: { aprioriConnu?: boolean } = {}): NoteDeLaCandidate | null {
	const completsPermis = calibre(m.complets.etat) || !calibre(m.sens.etat);
	const niveaux: NiveauDeNote[] = s.logit !== undefined && s.logit !== null && completsPermis ? ['complets', 'sens'] : ['sens'];
	const noterAu = (niveau: NiveauDeNote): NoteDeLaCandidate | null => {
		const { modele, etat } = m[niveau];
		if (etat === 'non_appris') return null;
		const n = noteDeConfiance(modele, niveau, s);
		if (n === null) return null;
		const aprioriManquant = options.aprioriConnu === false && (modele.poids.apriori ?? 0) > 0;
		return { ...n, niveau, accepte: calibre(etat) && !aprioriManquant, ...(etat === 'coupe' ? { coupee: true as const } : {}), ...(etat === 'depart' ? { depart: true as const } : {}) };
	};
	for (const [i, niveau] of niveaux.entries()) {
		const n = noterAu(niveau);
		if (n === null) continue;
		if (n.coupee !== true) return n;
		// niveau coupé : le suivant, accepté et pas coupé, relaie l'injection automatique
		const relais = niveaux.slice(i + 1).map(noterAu).find((r) => r !== null && r.accepte && r.coupee !== true) ?? null;
		return relais === null ? n : { ...n, relais };
	}
	return null;
}

/** La note qui décide de l'injection automatique : celle de la candidate, ou son relais si son niveau est coupé ; null : aucune. */
export function noteDInjection(n: NoteDeLaCandidate | null | undefined): NoteDeLaCandidate | null {
	if (n === null || n === undefined) return null;
	if (n.coupee !== true) return n;
	return n.relais ?? null;
}

/**
 * Ordre par la note : les candidates notées, de la plus haute à la plus basse, puis celles sans note ; à note égale (et entre
 * celles sans note), l'ordre donné. Stable : ne dépend que de l'ordre donné et des notes.
 */
export function ordonnerParNote<T>(lignes: readonly T[], note: (ligne: T) => number | null): T[] {
	const rang = new Map(lignes.map((l, i) => [l, i]));
	return [...lignes].sort((a, b) => {
		const na = note(a);
		const nb = note(b);
		if (na === null || nb === null) return na === nb ? rang.get(a)! - rang.get(b)! : na === null ? 1 : -1;
		return nb - na || rang.get(a)! - rang.get(b)!;
	});
}

/** `p` affichable d'une note : seulement d'un modèle accepté (un % calibré) ; null sinon. */
export const pCalibre = (n: NoteDeLaCandidate | null): number | null => (n !== null && n.accepte ? n.p : null);

/**
 * Le classement est-il calibré ? Oui si au moins une candidate est notée et que toutes les notes viennent de modèles acceptés :
 * le panneau peut montrer des %. Non sinon (ordre seul).
 */
export function classementCalibre(notes: Iterable<NoteDeLaCandidate | null>): boolean {
	let une = false;
	for (const n of notes) {
		if (n === null) continue;
		if (!n.accepte) return false;
		une = true;
	}
	return une;
}
