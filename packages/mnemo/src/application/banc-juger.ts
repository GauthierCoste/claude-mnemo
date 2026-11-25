/**
 * Banc du contexte : le jugement, une fiche à la fois (spec classement vivant § 6.1). Sans entrée ni sortie : l'adaptateur
 * montre la fiche, lit la touche et enregistre les cas après chaque réponse. On reprend toujours là où l'on s'est arrêté : la
 * prochaine fiche est la première non jugée du premier message ni jugé ni sauté.
 */
import { empreinte } from '../domaine/empreinte.ts';
import type { CandidateAJuger, CasContexte, Jugement } from './banc-contexte.ts';

/** Un message est à juger s'il a des candidates, n'est pas sauté, ni marqué silence, et qu'une candidate n'est pas jugée. */
export const aJuger = (c: CasContexte): boolean =>
	c.candidates !== undefined && c.candidates.length > 0 && c.saute !== true && !c.silence && c.candidates.some((x) => c.jugements?.[x.chemin] === undefined);

/** Message jugé : il a des candidates, n'est pas sauté, et il est marqué silence ou toutes ses candidates sont jugées. */
export const estJuge = (c: CasContexte): boolean => c.candidates !== undefined && c.candidates.length > 0 && c.saute !== true && !aJuger(c);

/**
 * Ordre de présentation des candidates d'un message : mêlé, fixe (empreinte du message et du chemin), sans rapport avec leur
 * rang ni leur note, pour ne pas biaiser le jugement.
 */
export function ordreDePresentation(c: CasContexte): CandidateAJuger[] {
	const cle = (x: CandidateAJuger) => empreinte(`${c.message}\n${x.chemin}`);
	return [...(c.candidates ?? [])].map((x) => ({ x, k: cle(x) })).sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0)).map(({ x }) => x);
}

/** La prochaine fiche à juger : le message (indice), la candidate, sa place parmi celles du message (1 = la première). */
export type AJuger = { indice: number; candidate: CandidateAJuger; place: number; sur: number };

export function prochaine(cas: readonly CasContexte[]): AJuger | null {
	const indice = cas.findIndex(aJuger);
	if (indice === -1) return null;
	const c = cas[indice]!;
	const ordre = ordreDePresentation(c);
	const place = ordre.findIndex((x) => c.jugements?.[x.chemin] === undefined);
	return { indice, candidate: ordre[place]!, place: place + 1, sur: ordre.length };
}

/** Messages jugés et total des messages à juger (sautés exclus), fiches jugées et total des fiches de ces messages. */
export function progression(cas: readonly CasContexte[]): { messagesJuges: number; messages: number; sautes: number; silences: number } {
	const avecCandidates = cas.filter((c) => c.candidates !== undefined && c.candidates.length > 0);
	return {
		messagesJuges: avecCandidates.filter(estJuge).length,
		messages: avecCandidates.filter((c) => c.saute !== true).length,
		sautes: avecCandidates.filter((c) => c.saute === true).length,
		silences: avecCandidates.filter((c) => c.saute !== true && c.silence).length,
	};
}

/**
 * Une réponse : juger la fiche, marquer le message « silence » (rien n'y est pertinent : ses fiches deviennent non pertinentes,
 * sauf celles déjà jugées indécises), ou le sauter.
 */
export type Reponse = { genre: 'juger'; jugement: Jugement } | { genre: 'silence' } | { genre: 'sauter' };
/** Ce qu'il faut pour annuler une réponse : le message tel qu'il était avant. */
export type Annulation = { indice: number; avant: CasContexte };

/**
 * Applique la réponse à la fiche `cible` (rendue par `prochaine`) : rend les cas modifiés (copie) et l'annulation. Le
 * silence est refusé (null) si une fiche du message est déjà jugée pertinente.
 */
export function repondre(cas: readonly CasContexte[], cible: AJuger, reponse: Reponse): { cas: CasContexte[]; annulation: Annulation } | null {
	const avant = cas[cible.indice]!;
	let apres: CasContexte;
	if (reponse.genre === 'juger') {
		apres = { ...avant, jugements: { ...avant.jugements, [cible.candidate.chemin]: reponse.jugement } };
	} else if (reponse.genre === 'silence') {
		if (Object.values(avant.jugements ?? {}).includes('pertinente')) return null;
		// une fiche jugée indécise le reste : « rien d'utile » ne tranche que les autres
		const jugements: Record<string, Jugement> = Object.fromEntries((avant.candidates ?? []).map((x) => [x.chemin, avant.jugements?.[x.chemin] === 'indecise' ? 'indecise' : 'non_pertinente']));
		apres = { ...avant, silence: true, jugements };
	} else {
		apres = { ...avant, saute: true };
	}
	const suivants = [...cas];
	suivants[cible.indice] = apres;
	return { cas: suivants, annulation: { indice: cible.indice, avant } };
}

/** Annule une réponse : le message retrouve son état d'avant. */
export function annuler(cas: readonly CasContexte[], annulation: Annulation): CasContexte[] {
	const suivants = [...cas];
	suivants[annulation.indice] = annulation.avant;
	return suivants;
}
