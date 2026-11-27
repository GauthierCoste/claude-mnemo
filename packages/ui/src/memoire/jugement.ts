/**
 * L'écran de jugement d'un message (spec « entraîner la note », D3), en fonctions pures : les choix de départ (jugement déjà
 * donné, sinon proposition du juge Claude), les fiches sans réponse que « Le reste n'est pas utile » touchera, les trois
 * demandes au service (valider, rien d'utile ici, passer), la progression. Vocabulaire (D9) : « Utile », « Pas utile »,
 * « Je ne sais pas », « Rien d'utile ici ».
 */
import type { CandidateAJugerVue, DemandeReponseMessage, JugementVue, PropositionDuJugeVue, VueMessageAJuger } from '@mnemo/contrat';
import type { TextesEntrainer } from './entrainement.ts';
import { TEXTES } from '../langue/textes.ts';

const FR: TextesEntrainer = TEXTES.fr.memoire.entrainer;

/** Les trois choix d'une fiche, dans l'ordre de l'écran. */
export const JUGEMENTS: readonly JugementVue[] = ['pertinente', 'non_pertinente', 'indecise'];

/** Raccourcis d'une fiche : o (oui) Utile, n (non) Pas utile, i (indécis) Je ne sais pas. */
export const TOUCHES_JUGEMENTS: Readonly<Record<string, JugementVue>> = { o: 'pertinente', n: 'non_pertinente', i: 'indecise' };

/** Les choix de l'écran, par chemin ; une fiche absente n'a pas de réponse. */
export type Choix = Readonly<Record<string, JugementVue>>;

/** Au départ : le jugement déjà donné, sinon la proposition du juge (pré-sélectionnée, l'utilisateur la change ou la valide). */
export function choixDeDepart(candidates: readonly CandidateAJugerVue[]): Choix {
	const choix: Record<string, JugementVue> = {};
	for (const c of candidates) {
		const j = c.jugement ?? c.proposition?.jugement;
		if (j !== undefined) choix[c.chemin] = j;
	}
	return choix;
}

/** Les fiches sans réponse : celles que « Le reste n'est pas utile » jugera « Pas utile ». */
export const sansReponse = (candidates: readonly CandidateAJugerVue[], choix: Choix): number => candidates.filter((c) => choix[c.chemin] === undefined).length;

/** Une fiche est marquée « Utile » : « Rien d'utile ici » serait refusé par le service. */
export const marqueeUtile = (choix: Choix): boolean => Object.values(choix).includes('pertinente');

/** Les choix des seules candidates du message. */
function jugementsDe(m: VueMessageAJuger, choix: Choix): Record<string, JugementVue> {
	return Object.fromEntries(m.candidates.flatMap((c) => (choix[c.chemin] === undefined ? [] : [[c.chemin, choix[c.chemin]!]])));
}

/** « Valider » : les choix (propositions du juge comprises : validées par ce geste), et le reste « pas utile » si coché. */
export const demandeValider = (m: VueMessageAJuger, choix: Choix, resteNonUtile: boolean): DemandeReponseMessage => ({ indice: m.indice, jugements: jugementsDe(m, choix), resteNonUtile });

/** « Rien d'utile ici » : le message est un silence ; une fiche choisie « Je ne sais pas » le reste. */
export const demandeSilence = (m: VueMessageAJuger, choix: Choix): DemandeReponseMessage => ({ indice: m.indice, jugements: jugementsDe(m, choix), resteNonUtile: true, silence: true });

/** « Passer » : le message est mis de côté, rien n'est jugé. */
export const demandePasser = (m: VueMessageAJuger): DemandeReponseMessage => ({ indice: m.indice, jugements: {}, resteNonUtile: false, passer: true });

/** Messages encore à juger après celui-ci (`restants` le compte tant qu'il n'est ni validé, ni silence, ni passé). */
export function apresCeluiCi(m: Pick<VueMessageAJuger, 'restants' | 'valide' | 'silence' | 'saute'>): number {
	const compteCeluiCi = !m.valide && !m.silence && !m.saute;
	return Math.max(0, m.restants - (compteCeluiCi ? 1 : 0));
}

/** La progression : « Message 3 – 2 autres à juger », `numero` étant le rang du message dans cette séance de jugement. */
export function progression(numero: number, m: Pick<VueMessageAJuger, 'restants' | 'valide' | 'silence' | 'saute'>, t: TextesEntrainer = FR): string {
	return t.jugement.progression(numero, apresCeluiCi(m));
}

/** La proposition du juge en clair : « Claude propose Utile (sûr à 96 %) : raison ». */
export const propositionEnClair = (p: PropositionDuJugeVue, t: TextesEntrainer = FR): string => t.jugement.proposition(t.jugement.noms[p.jugement], t.pourcent(p.confiance), p.raison);
