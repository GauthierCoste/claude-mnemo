// Injection automatique d'une fiche entière (spec classement vivant § 3.4) : quelles candidates d'un message la note de
// confiance permet d'injecter, de la mieux notée à la moins bien notée. Pur. Le plafond par message et la taille de la fiche
// (lue dans le coffre) restent à l'appelant : une fiche trop longue n'est pas injectée, elle reste une piste.

import type { NoteDeLaCandidate } from './note-de-confiance.ts';

/**
 * Garde de l'a priori : `p_sans_apriori` minimal d'une injection automatique (l'historique des gestes seul ne fait pas
 * injecter). Valeur de départ, la même au banc (`REGLAGE_PAR_DEFAUT.garde`).
 */
export const GARDE_APRIORI = 0.7;

/** Au seuil de 100 %, jamais d'injection automatique (réglage `contexte.seuilInjection`). */
export const SEUIL_JAMAIS = 100;

/**
 * Les candidates injectables, `p` décroissant (à égalité, l'ordre donné) : notées par un modèle accepté (ni refusé, a priori
 * lu s'il le pèse : `accepte`) et pas coupé par le suivi (`coupee`), toutes ses variables calculées (une note non nulle), `p ≥ seuil`
 * (`seuilInjection`, en % ; 100 : aucune), `p_sans_apriori ≥ GARDE_APRIORI`, et pas déjà vues par la session (`vue` :
 * injectée, lue ou écrite à cette empreinte).
 */
export function injectables(
	candidates: readonly string[],
	note: (chemin: string) => NoteDeLaCandidate | null | undefined,
	seuilInjection: number,
	vue: (chemin: string) => boolean,
): string[] {
	if (seuilInjection >= SEUIL_JAMAIS) return [];
	const seuil = seuilInjection / 100;
	const rang = new Map(candidates.map((c, i) => [c, i]));
	return candidates
		.flatMap((chemin) => {
			const n = note(chemin);
			return n !== null && n !== undefined && n.accepte && n.coupee !== true && n.p >= seuil && n.pSansApriori >= GARDE_APRIORI && !vue(chemin) ? [{ chemin, p: n.p }] : [];
		})
		.sort((a, b) => b.p - a.p || rang.get(a.chemin)! - rang.get(b.chemin)!)
		.map((c) => c.chemin);
}
