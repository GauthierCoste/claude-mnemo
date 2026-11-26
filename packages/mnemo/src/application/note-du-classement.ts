/**
 * La note de confiance appliquée au classement d'un message (spec classement vivant § 4, décisions du 25/11) : les modèles de
 * la mémoire (`dep.note`, sinon le module du dépôt), puis la note de chaque ligne et l'ordre qu'elle donne. Le hook, l'affinage
 * et l'outil `contexte` l'appliquent tous trois : un même message donne la même note partout.
 *
 * - Modèle accepté : `p` (un % calibré) sur chaque ligne qu'il note, classement `calibree`.
 * - Modèle appris mais refusé (ou appris pour d'autres GGUF), ou de départ : sa note ordonne et choisit les pistes, `p` reste
 *   null (aucun % calibré) ; elle est gardée à part (`pNonCalibree`, avec `depart` pour un modèle de départ), pour être montrée
 *   en gris.
 * - Aucun modèle appris, ou aucune ligne notée (le sens n'a pas répondu) : l'ordre donné (règle provisoire), inchangé.
 */
import { COEFFICIENTS_NOTE } from '../domaine/coefficients-note.ts';
import { echelleDesSignaux, modeleNonAppris } from '../domaine/modele-de-note.ts';
import type { RequeteDeNote } from '../domaine/modele-de-note.ts';
import { REGLAGES_PAR_DEFAUT } from '../domaine/reglages.ts';
import type { Reglages } from '../domaine/reglages.ts';
import { classementCalibre, modelesDeNote, noteApprise, noterLaCandidate, ordonnerParNote, pCalibre } from '../domaine/note-de-confiance.ts';
import type { ModelesDeNote, NoteDeLaCandidate } from '../domaine/note-de-confiance.ts';
import type { LigneDeClassement } from './classement-du-message.ts';
import type { Dependances } from './ports.ts';

/**
 * Les modèles de note de la mémoire, avec leur état pour les modèles installés et l'échelle actuelle des signaux (réglages) ;
 * sans lecteur (`dep.note` absent), le module du dépôt (les modèles de départ) ; une lecture en panne vaut aucun modèle appris,
 * comme un fichier abîmé (`coefficients-note-fichier.ts`) : les modèles de départ ne remplacent jamais ceux de la mémoire. Lus
 * une fois par message (`DemandeServir.modeles`).
 */
export function modelesActifs(dep: Pick<Dependances, 'note' | 'reglages'>): ModelesDeNote {
	let charge: ReturnType<NonNullable<Dependances['note']>> | undefined;
	try {
		charge = dep.note?.();
	} catch {
		charge = { coefficients: { complets: modeleNonAppris(), sens: modeleNonAppris() }, installes: { sens: null, reranker: null } };
	}
	let contexte: Reglages['contexte'];
	try {
		contexte = dep.reglages().contexte;
	} catch {
		contexte = REGLAGES_PAR_DEFAUT.contexte;
	}
	return modelesDeNote(charge?.coefficients ?? COEFFICIENTS_NOTE, charge?.installes ?? { sens: null, reranker: null }, echelleDesSignaux(contexte));
}

/**
 * La variante de requête des modèles appris (celle du Sens seul, qui note toutes les candidates, sinon celle du Complets) : le hook
 * forme la requête comme le modèle a été appris ; null sans modèle appris.
 */
export function requeteDesModeles(m: ModelesDeNote): RequeteDeNote | null {
	if (m.sens.etat !== 'non_appris') return m.sens.modele.requete;
	if (m.complets.etat !== 'non_appris') return m.complets.modele.requete;
	return null;
}

/**
 * Un classement noté. `parNote` : un modèle appris note au moins une ligne, sa note ordonne (`lignes`) et choisit les pistes ;
 * faux : l'ordre donné, règle provisoire. `notes` : la note de chaque ligne (null : aucun modèle ne la note). `calibree` : toutes
 * les notes viennent de modèles acceptés.
 */
export type ClassementNote = { lignes: LigneDeClassement[]; notes: ReadonlyMap<string, NoteDeLaCandidate | null>; parNote: boolean; calibree: boolean };

/**
 * Note chaque ligne (son logit, s'il est là, la fait noter au niveau Complets ; sinon Sens seul) et, si un modèle appris en note
 * au moins une, les range par leur note (les lignes sans note ensuite, dans l'ordre donné). `p` et `pSansApriori` : seulement
 * d'une note calibrée (modèle accepté, a priori lu s'il pèse) ; null sinon. `aprioriConnu` : l'a priori des gestes a été lu.
 */
export function noterLeClassement(lignes: readonly LigneDeClassement[], modeles: ModelesDeNote, options: { aprioriConnu: boolean }): ClassementNote {
	const sansNote = (): ClassementNote => ({ lignes: lignes.map(({ pSansApriori: _p, pNonCalibree: _n, depart: _d, ...l }) => ({ ...l, p: null })), notes: new Map(), parNote: false, calibree: false });
	if (!noteApprise(modeles)) return sansNote();
	const notes = new Map(lignes.map((l) => [l.chemin, noterLaCandidate(modeles, { ...l.signaux, logit: l.logit }, options)]));
	if (![...notes.values()].some((n) => n !== null)) return { ...sansNote(), notes };
	const rangees = ordonnerParNote(lignes, (l) => notes.get(l.chemin)?.p ?? null).map((l): LigneDeClassement => {
		const { pSansApriori: _ancien, pNonCalibree: _ancienne, depart: _depart, ...reste } = l;
		const n = notes.get(l.chemin) ?? null;
		const p = pCalibre(n);
		if (p !== null) return { ...reste, p, pSansApriori: n!.pSansApriori };
		return n === null ? { ...reste, p: null } : { ...reste, p: null, pNonCalibree: n.p, ...(n.depart === true ? { depart: true as const } : {}) };
	});
	return { lignes: rangees, notes, parNote: true, calibree: classementCalibre(notes.values()) };
}

/** Vrai si la note de la ligne (accepté ou non) atteint le seuil des pistes (`seuilPiste`, en %). */
export function auSeuilDePiste(note: NoteDeLaCandidate | null | undefined, seuilPiste: number): boolean {
	return note !== null && note !== undefined && note.p >= seuilPiste / 100;
}
