// Note de confiance d'une candidate (spec classement vivant § 4.2) : `p = σ(z)`, `z = biais + Σ poids·variable`, d'après ses
// signaux bruts et le modèle de son niveau, avec les conventions de l'apprentissage (`variablesDeNote` : bm25 relatif null = 0,
// signal de session ou a priori absent = 0, cosinus relatif null : pas de note). `p_sans_apriori` : le même `z` sans le terme
// de l'a priori. Pur.
//
// Trois régimes (décisions du 25/11) : un modèle **accepté** donne `p` (un %, calibré) ; un modèle **appris mais refusé** (critères
// manqués, ou appris pour d'autres fichiers GGUF que ceux installés) ordonne le classement et choisit les pistes par sa note, sans
// % ni injection ; **aucun modèle appris** : la règle provisoire (ordre par le sens et les poids des signaux).

import { identiteDifferente, variablesDeNote, VARIABLES_DU_NIVEAU } from './modele-de-note.ts';
import type { CoefficientsNote, IdentiteDesModeles, ModeleDeNote, NiveauDeNote, SignauxDeNote } from './modele-de-note.ts';
import { sigmoide } from './regression-logistique.ts';

/** Un modèle accepté et utilisable ; appris mais refusé (ou d'autres GGUF) ; jamais appris. */
export type EtatDuModele = 'accepte' | 'refuse' | 'non_appris';

/**
 * État d'un modèle pour les modèles installés : jamais appris (aucune date d'apprentissage) ; refusé s'il n'a pas passé
 * l'acceptation ou s'il a été appris pour d'autres fichiers GGUF que ceux installés (`identiteDifferente`) ; accepté sinon.
 */
export function etatDuModele(m: ModeleDeNote, installes: IdentiteDesModeles): EtatDuModele {
	if (m.apprisLe === null) return 'non_appris';
	return m.accepte && !identiteDifferente(m.gguf, installes) ? 'accepte' : 'refuse';
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

export function modelesDeNote(c: CoefficientsNote, installes: IdentiteDesModeles): ModelesDeNote {
	return {
		complets: { modele: c.complets, etat: etatDuModele(c.complets, installes) },
		sens: { modele: c.sens, etat: etatDuModele(c.sens, installes) },
	};
}

/** Vrai si au moins un niveau a un modèle appris (accepté ou refusé) : sa note ordonne ; sinon, la règle provisoire. */
export function noteApprise(m: ModelesDeNote): boolean {
	return m.complets.etat !== 'non_appris' || m.sens.etat !== 'non_appris';
}

/**
 * La note d'une candidate : `p` et `p_sans_apriori` du niveau qui la note, et si ce modèle est accepté (`p` est alors un %
 * calibré, utilisable pour l'injection). Niveau Complets pour une candidate notée par le reranker (`logit`), si son modèle est
 * appris et que ses variables sont là ; sinon Sens seul, si son modèle est appris. Null : aucun modèle appris ne la note
 * (cosinus absent, ou aucun modèle du niveau).
 */
export type NoteDeLaCandidate = { p: number; pSansApriori: number; niveau: NiveauDeNote; accepte: boolean };

export function noterLaCandidate(m: ModelesDeNote, s: SignauxDeNote): NoteDeLaCandidate | null {
	const niveaux: NiveauDeNote[] = s.logit !== undefined && s.logit !== null ? ['complets', 'sens'] : ['sens'];
	for (const niveau of niveaux) {
		const { modele, etat } = m[niveau];
		if (etat === 'non_appris') continue;
		const n = noteDeConfiance(modele, niveau, s);
		if (n !== null) return { ...n, niveau, accepte: etat === 'accepte' };
	}
	return null;
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
