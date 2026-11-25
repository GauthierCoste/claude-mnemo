// Acceptation d'une note de confiance (spec classement vivant § 4.3) : injections simulées au banc à un seuil, précision et
// borne de Wilson, part des messages silence servis, injections par message, rappel, calibration. Pur.
//
// Règles de la simulation :
// - une fiche est injectée si `p ≥ seuil` et `p_sans_apriori ≥ garde` (spec § 3.4), au plus `injectionsParMessage` par
//   message, les mieux notées ;
// - les fiches non jugées restent parmi les injections : la précision pessimiste (celle du critère) les compte fausses ;
// - les fiches tirées hors de la pile (`horsPile`) ne sont pas injectées : elles mesurent le rappel (ce que la pile laisse de
//   côté), pas la précision ; une pertinente hors pile compte comme retrouvée si sa note passe le seuil et la garde ;
// - abstention (facultative) : rien n'est injecté dans un message où la dernière injectée devance la suivante de moins de
//   `abstention` (la coupure y est floue).

import { ece, intervalleWilson, tableDeFiabilite } from './mesures-banc.ts';
import type { TrancheFiabilite } from './mesures-banc.ts';

export type StatutDeJugement = 'pertinente' | 'non_pertinente' | 'non_jugee';
/** Une candidate notée : `p`, `p` sans le terme de l'a priori, son jugement, et si elle a été tirée hors de la pile. */
export type CandidateNotee = { p: number; pSansApriori: number; statut: StatutDeJugement; horsPile: boolean };
/** Un message noté : sa session (plis, sessions servies), s'il est silence, ses candidates notées. */
export type MessageNote = { session: string; silence: boolean; candidates: readonly CandidateNotee[] };

export type ReglageDInjection = {
	seuil: number;
	injectionsParMessage: number;
	/** Garde de l'a priori : `p_sans_apriori` minimal (spec § 3.4 : 0,7). */
	garde: number;
	/** Écart minimal entre la dernière injectée et la suivante ; null : pas d'abstention. */
	abstention: number | null;
};

export const REGLAGE_PAR_DEFAUT: ReglageDInjection = { seuil: 0.9, injectionsParMessage: 2, garde: 0.7, abstention: null };

export type MesuresDInjection = {
	seuil: number;
	messages: number;
	injections: number;
	justes: number;
	nonJugees: number;
	/** Sur les seules injectées jugées ; null sans injection jugée. */
	precision: number | null;
	/** Les non jugées comptées fausses ; null sans injection. */
	precisionPessimiste: number | null;
	wilsonBasse: number;
	wilsonBassePessimiste: number;
	/** Sessions où au moins une fiche est injectée. */
	sessions: number;
	injectionsParMessage: number;
	silences: number;
	silencesAvecInjection: number;
	/** Part des messages silence qui reçoivent une injection ; null sans message silence. */
	partSilencesAvecInjection: number | null;
	/** Pertinentes retrouvées (injectées, ou hors pile au-dessus du seuil) sur toutes les pertinentes ; null sans pertinente. */
	rappel: number | null;
	/** Messages laissés par l'abstention. */
	abstenus: number;
};

const part = (n: number, d: number): number | null => (d === 0 ? null : n / d);

/** Injections simulées d'un message (candidates de la pile seules), et s'il s'est abstenu. */
function injectees(m: MessageNote, r: ReglageDInjection): { injectees: CandidateNotee[]; abstenu: boolean } {
	const rangees = m.candidates.filter((c) => !c.horsPile).sort((a, b) => b.p - a.p);
	const prises = rangees.filter((c) => c.p >= r.seuil && c.pSansApriori >= r.garde).slice(0, r.injectionsParMessage);
	if (r.abstention === null || prises.length === 0) return { injectees: prises, abstenu: false };
	const derniere = prises[prises.length - 1]!;
	const suivante = rangees[rangees.indexOf(derniere) + 1];
	if (suivante !== undefined && derniere.p - suivante.p < r.abstention) return { injectees: [], abstenu: true };
	return { injectees: prises, abstenu: false };
}

export function simulerInjections(messages: readonly MessageNote[], r: ReglageDInjection = REGLAGE_PAR_DEFAUT): MesuresDInjection {
	let injections = 0;
	let justes = 0;
	let nonJugees = 0;
	let silences = 0;
	let silencesAvecInjection = 0;
	let retrouvees = 0;
	let pertinentes = 0;
	let abstenus = 0;
	const sessions = new Set<string>();
	for (const m of messages) {
		const s = injectees(m, r);
		if (s.abstenu) abstenus += 1;
		injections += s.injectees.length;
		justes += s.injectees.filter((c) => c.statut === 'pertinente').length;
		nonJugees += s.injectees.filter((c) => c.statut === 'non_jugee').length;
		if (s.injectees.length > 0) sessions.add(m.session);
		if (m.silence) {
			silences += 1;
			if (s.injectees.length > 0) silencesAvecInjection += 1;
		}
		for (const c of m.candidates) {
			if (c.statut !== 'pertinente') continue;
			pertinentes += 1;
			const retrouvee = c.horsPile ? !s.abstenu && c.p >= r.seuil && c.pSansApriori >= r.garde : s.injectees.includes(c);
			if (retrouvee) retrouvees += 1;
		}
	}
	return {
		seuil: r.seuil,
		messages: messages.length,
		injections,
		justes,
		nonJugees,
		precision: part(justes, injections - nonJugees),
		precisionPessimiste: part(justes, injections),
		wilsonBasse: intervalleWilson(justes, injections - nonJugees).basse,
		wilsonBassePessimiste: intervalleWilson(justes, injections).basse,
		sessions: sessions.size,
		injectionsParMessage: messages.length === 0 ? 0 : injections / messages.length,
		silences,
		silencesAvecInjection,
		partSilencesAvecInjection: part(silencesAvecInjection, silences),
		rappel: part(retrouvees, pertinentes),
		abstenus,
	};
}

/** Calibration sur les paires jugées de la pile : table de fiabilité et ECE (p ≥ 0,5). */
export function calibration(messages: readonly MessageNote[]): { ece: number | null; fiabilite: TrancheFiabilite[] } {
	const paires = messages.flatMap((m) => m.candidates.flatMap((c) => (c.horsPile || c.statut === 'non_jugee' ? [] : [{ p: c.p, pertinente: c.statut === 'pertinente' }])));
	return { ece: ece(paires), fiabilite: tableDeFiabilite(paires) };
}

/** Critères d'acceptation de la spec § 4.3, au seuil par défaut. */
export const CRITERES = {
	precisionMin: 0.9,
	wilsonBasseMin: 0.85,
	injectionsMin: 50,
	sessionsMin: 20,
	eceMax: 0.05,
	partSilencesMax: 0.05,
	injectionsParMessageMax: 0.5,
} as const;

const pc = (x: number) => `${Math.round(x * 1000) / 10} %`;

/**
 * Le modèle est-il accepté ? Précision pessimiste, borne basse de Wilson pessimiste, nombre d'injections et de sessions, ECE,
 * silences servis, injections par message. `refus` : chaque critère manqué, en clair (aucun texte de fiche). Sans message
 * silence, le critère des silences ne peut pas manquer (il est rapporté à part).
 */
export function accepter(m: MesuresDInjection, eceMesuree: number | null): { accepte: boolean; refus: string[] } {
	const c = CRITERES;
	const refus: string[] = [];
	if (m.injections < c.injectionsMin) refus.push(`${m.injections} injections simulées (au moins ${c.injectionsMin})`);
	if (m.sessions < c.sessionsMin) refus.push(`${m.sessions} sessions servies (au moins ${c.sessionsMin})`);
	if (m.precisionPessimiste === null || m.precisionPessimiste < c.precisionMin) {
		refus.push(`précision ${m.precisionPessimiste === null ? '-' : pc(m.precisionPessimiste)} (au moins ${pc(c.precisionMin)})`);
	}
	if (m.wilsonBassePessimiste < c.wilsonBasseMin) refus.push(`borne basse de Wilson ${pc(m.wilsonBassePessimiste)} (au moins ${pc(c.wilsonBasseMin)})`);
	if (eceMesuree === null || eceMesuree > c.eceMax) refus.push(`ECE ${eceMesuree === null ? '- (aucune paire à p ≥ 0,5)' : eceMesuree.toFixed(3)} (au plus ${c.eceMax})`);
	if (m.partSilencesAvecInjection !== null && m.partSilencesAvecInjection > c.partSilencesMax) {
		refus.push(`${pc(m.partSilencesAvecInjection)} des messages silence servis (au plus ${pc(c.partSilencesMax)})`);
	}
	if (m.injectionsParMessage > c.injectionsParMessageMax) refus.push(`${m.injectionsParMessage.toFixed(2)} injection par message (au plus ${c.injectionsParMessageMax})`);
	return { accepte: refus.length === 0, refus };
}
