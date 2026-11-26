/**
 * Banc du contexte : le jugement, une fiche à la fois (spec classement vivant § 6.1). Sans entrée ni sortie : l'adaptateur
 * montre la fiche, lit la touche et enregistre les cas après chaque réponse. On reprend toujours là où l'on s'est arrêté : la
 * prochaine fiche est la première non jugée du premier message ni jugé ni sauté.
 */
import { empreinte } from '../domaine/empreinte.ts';
import type { CandidateAJuger, CasContexte, Jugement, Prejugement } from './banc-contexte.ts';

/**
 * Un message est à juger s'il a des candidates, n'est pas sauté, ni marqué silence, ni validé entier, et qu'une candidate n'est
 * pas jugée.
 */
export const aJuger = (c: CasContexte): boolean =>
	c.candidates !== undefined &&
	c.candidates.length > 0 &&
	c.saute !== true &&
	!c.silence &&
	c.valideLe === undefined &&
	c.candidates.some((x) => c.jugements?.[x.chemin] === undefined);

/** Message jugé : il a des candidates, n'est pas sauté, et il est marqué silence, validé entier, ou toutes ses candidates sont jugées. */
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

/**
 * Messages jugés et total des messages à juger (sautés exclus), sautés, silences, messages à relire (propositions du juge en
 * attente) et paires validées : fiches candidates jugées utiles ou pas utiles des messages non sautés, même jugés en partie
 * (comme le rejeu et l'apprentissage les prennent) ; les indécises n'en sont pas.
 */
export type Progression = { messagesJuges: number; messages: number; sautes: number; silences: number; aRelire: number; pairesValidees: number };

export function progression(cas: readonly CasContexte[]): Progression {
	const avecCandidates = cas.filter((c) => c.candidates !== undefined && c.candidates.length > 0);
	return {
		messagesJuges: avecCandidates.filter(estJuge).length,
		messages: avecCandidates.filter((c) => c.saute !== true).length,
		sautes: avecCandidates.filter((c) => c.saute === true).length,
		silences: avecCandidates.filter((c) => c.saute !== true && c.silence).length,
		aRelire: messagesARelire(cas).length,
		pairesValidees: avecCandidates.filter((c) => c.saute !== true).reduce((n, c) => n + (c.candidates ?? []).filter((x) => c.jugements?.[x.chemin] === 'pertinente' || c.jugements?.[x.chemin] === 'non_pertinente').length, 0),
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

/** Les propositions du juge pour les candidates du message (celles d'autres chemins sont ignorées). */
const propositions = (c: CasContexte): Prejugement[] => (c.candidates ?? []).flatMap((x) => (c.prejugements?.[x.chemin] === undefined ? [] : [c.prejugements[x.chemin]!]));

/**
 * Confiance moyenne sur toutes les candidates du message : une candidate sans proposition compte 0 (un message aux propositions
 * incomplètes est plus incertain, donc relu plus tôt).
 */
const confianceMoyenne = (c: CasContexte): number => {
	const candidates = c.candidates ?? [];
	return candidates.reduce((n, x) => n + (c.prejugements?.[x.chemin]?.confiance ?? 0), 0) / candidates.length;
};

/**
 * Indices des messages à juger qui ont au moins une proposition du juge, les plus incertains d'abord (confiance moyenne la plus
 * basse, une candidate sans proposition comptant 0).
 */
export function messagesARelire(cas: readonly CasContexte[]): number[] {
	return cas
		.flatMap((c, indice) => (aJuger(c) && propositions(c).length > 0 ? [{ indice, confiance: confianceMoyenne(c) }] : []))
		.sort((a, b) => a.confiance - b.confiance || a.indice - b.indice)
		.map(({ indice }) => indice);
}

/** Le prochain message à juger : d'abord ceux à relire, puis les autres dans l'ordre du fichier ; null s'il n'y en a plus. */
export function prochainMessage(cas: readonly CasContexte[]): number | null {
	const aRelire = messagesARelire(cas);
	if (aRelire.length > 0) return aRelire[0]!;
	const indice = cas.findIndex(aJuger);
	return indice === -1 ? null : indice;
}

/**
 * La réponse à un message entier (spec D3) : les jugements donnés par fiche, et si « le reste n'est pas utile » est coché, les
 * fiches laissées sans réponse deviennent non pertinentes. `silence` : « Rien d'utile ici » ; `passer` : le message est sauté.
 */
export type ReponseMessage = { jugements: Record<string, Jugement>; resteNonUtile: boolean; silence?: boolean; passer?: boolean };
/** `maintenant` : date de validation (ISO) ; l'heure courante par défaut. */
export type OptionsValidation = { maintenant?: string };

/**
 * Applique la réponse au message `indice` : rend les cas modifiés (copie) et l'annulation. Un message validé (ni passé) porte
 * `valideLe` et il est jugé (`estJuge`). Les jugements donnés pour un chemin qui n'est pas candidate sont ignorés. Le silence est
 * refusé (null) si une fiche est jugée pertinente, déjà ou dans la réponse ; null aussi pour un indice hors des cas ou un message
 * sans candidates (étiqueté à la main). Un message rouvert par son indice (sauté) puis validé ou marqué silence compte à nouveau.
 */
export function repondreMessage(cas: readonly CasContexte[], indice: number, reponse: ReponseMessage, options: OptionsValidation = {}): { cas: CasContexte[]; annulation: Annulation } | null {
	const avant = cas[indice];
	if (avant?.candidates === undefined || avant.candidates.length === 0) return null;
	const chemins = avant.candidates.map((x) => x.chemin);
	let apres: CasContexte;
	if (reponse.passer === true) {
		apres = { ...avant, saute: true };
	} else {
		const donnes = Object.fromEntries(Object.entries(reponse.jugements).filter(([chemin]) => chemins.includes(chemin)));
		const fusion: Record<string, Jugement> = { ...avant.jugements, ...donnes };
		const valideLe = options.maintenant ?? new Date().toISOString();
		const { saute: _saute, ...reste } = avant;
		if (reponse.silence === true) {
			if (Object.values(fusion).includes('pertinente')) return null;
			// une fiche jugée indécise le reste : « rien d'utile » ne tranche que les autres
			const jugements: Record<string, Jugement> = Object.fromEntries(chemins.map((c) => [c, fusion[c] === 'indecise' ? 'indecise' : 'non_pertinente']));
			apres = { ...reste, silence: true, jugements, valideLe };
		} else {
			const jugements: Record<string, Jugement> = reponse.resteNonUtile ? { ...Object.fromEntries(chemins.map((c) => [c, 'non_pertinente'])), ...fusion } : fusion;
			apres = { ...reste, silence: false, jugements, valideLe };
		}
	}
	const suivants = [...cas];
	suivants[indice] = apres;
	return { cas: suivants, annulation: { indice, avant } };
}

/**
 * « Accepter les sûres » (spec D5) : chaque message à juger dont les propositions couvrent toutes les candidates, toutes de
 * confiance au moins `seuil`, est validé avec ces propositions pour jugements (un jugement déjà donné à la main est gardé). Les
 * autres attendent la relecture. Rend les cas (copie) et le nombre de messages acceptés.
 */
export function accepterSures(cas: readonly CasContexte[], seuil = 0.9, options: OptionsValidation = {}): { cas: CasContexte[]; acceptes: number } {
	const valideLe = options.maintenant ?? new Date().toISOString();
	let acceptes = 0;
	const suivants = cas.map((c): CasContexte => {
		if (!aJuger(c)) return c;
		const candidates = c.candidates ?? [];
		const sures = candidates.every((x) => (c.prejugements?.[x.chemin]?.confiance ?? -1) >= seuil);
		if (!sures) return c;
		acceptes++;
		const proposes: Record<string, Jugement> = Object.fromEntries(candidates.map((x) => [x.chemin, c.prejugements![x.chemin]!.jugement]));
		return { ...c, jugements: { ...proposes, ...c.jugements }, valideLe };
	});
	return { cas: suivants, acceptes };
}
