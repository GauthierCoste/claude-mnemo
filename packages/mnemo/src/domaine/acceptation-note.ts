// Acceptation d'une note de confiance (spec classement vivant § 4.3, critères revus après la contre-expertise du 25/11) :
// injections et pistes simulées au banc, précision, borne de Wilson, bootstrap groupé par session, pente de calibration,
// messages silence servis, injections par message, rappel. Pur.
//
// Règles de la simulation, comme au hook :
// - les messages d'une session sont servis dans l'ordre ; une fiche injectée dans une session ne l'est plus ensuite (une fois
//   par session) ; les cas étiquetés à la main (pseudo-session `manuel`) sont des messages indépendants ;
// - une fiche est injectée si elle est injectable (au niveau Complets : notée par le reranker au hook), `p ≥ seuil` et
//   `p_sans_apriori ≥ garde` (spec § 3.4), au plus `injectionsParMessage` par message, les mieux notées ;
// - pistes : les mieux notées des autres, `p ≥ seuilPiste`, au plus `pistesParMessage` ;
// - une fiche non jugée ou indécise injectée compte fausse (précision pessimiste, celle du critère) ; une fiche tirée hors de
//   la pile est une candidate comme une autre : non pertinente ou non jugée et injectée, elle compte fausse.

import { ece as eceDe, hasardFixe, intervalleWilson, tableDeFiabilite } from './mesures-banc.ts';
import type { TrancheFiabilite } from './mesures-banc.ts';
import { apprendreRegression } from './regression-logistique.ts';
import { GARDE_APRIORI } from './injection-automatique.ts';

/** Pseudo-session des cas étiquetés à la main (sans session d'origine) : elle ne compte pas parmi les sessions réelles. */
export const SESSION_MANUELLE = 'manuel';

/** `non_jugee` : pas encore jugée, ou jugée indécise. */
export type StatutDeJugement = 'pertinente' | 'non_pertinente' | 'non_jugee';
/** Une candidate notée : `z` (la marge), `p = σ(z)`, `p` sans le terme de l'a priori, son jugement, d'où elle vient. */
export type CandidateNotee = { chemin: string; z: number; p: number; pSansApriori: number; statut: StatutDeJugement; horsPile: boolean; injectable: boolean };
/** Un message noté : sa session (`manuel` pour les cas étiquetés à la main), son rang, s'il est silence, ses candidates. */
export type MessageNote = { session: string; rang: number; silence: boolean; candidates: readonly CandidateNotee[] };

export type ReglageDInjection = {
	seuil: number;
	injectionsParMessage: number;
	/** Garde de l'a priori : `p_sans_apriori` minimal (spec § 3.4 : 0,7). */
	garde: number;
	seuilPiste: number;
	pistesParMessage: number;
};

export const REGLAGE_PAR_DEFAUT: ReglageDInjection = { seuil: 0.9, injectionsParMessage: 2, garde: GARDE_APRIORI, seuilPiste: 0.1, pistesParMessage: 3 };

const estReelle = (session: string) => session !== SESSION_MANUELLE;
const part = (n: number, d: number): number | null => (d === 0 ? null : n / d);

type Service = { message: MessageNote; injectees: CandidateNotee[]; pistes: CandidateNotee[] };

/** Ce que chaque message reçoit : injections (une fois par session) et pistes, messages pris dans l'ordre de leur session. */
export function servirLesMessages(messages: readonly MessageNote[], r: ReglageDInjection): Service[] {
	const ordre = [...messages].sort((a, b) => (a.session < b.session ? -1 : a.session > b.session ? 1 : a.rang - b.rang));
	const dejaInjectees = new Map<string, Set<string>>();
	return ordre.map((m) => {
		const deja = estReelle(m.session) ? (dejaInjectees.get(m.session) ?? new Set<string>()) : new Set<string>();
		dejaInjectees.set(m.session, deja);
		const rangees = m.candidates.filter((c) => !deja.has(c.chemin)).sort((a, b) => b.p - a.p);
		const injectees = rangees.filter((c) => c.injectable && c.p >= r.seuil && c.pSansApriori >= r.garde).slice(0, r.injectionsParMessage);
		const pistes = rangees.filter((c) => !injectees.includes(c) && c.p >= r.seuilPiste).slice(0, r.pistesParMessage);
		for (const c of injectees) deja.add(c.chemin);
		return { message: m, injectees, pistes };
	});
}

export type MesuresDInjection = {
	seuil: number;
	messages: number;
	injections: number;
	justes: number;
	/** Injectées non jugées ou indécises (comptées fausses). */
	nonJugees: number;
	/** Injectées hors pile, non pertinentes ou non jugées (comptées fausses). */
	horsPileFausses: number;
	/** Sur les seules injectées jugées ; null sans injection jugée. */
	precision: number | null;
	/** Les non jugées comptées fausses ; null sans injection. */
	precisionPessimiste: number | null;
	wilsonBassePessimiste: number;
	/** Sessions réelles où au moins une fiche est injectée. */
	sessions: number;
	injectionsParMessage: number;
	silences: number;
	/** Sessions réelles d'où viennent les messages silence. */
	sessionsSilence: number;
	silencesAvecInjection: number;
	partSilencesAvecInjection: number | null;
	/** Pertinentes injectées sur toutes les pertinentes (pile et hors pile) ; null sans pertinente. */
	rappel: number | null;
	/** Pertinentes injectées ou en piste, sur toutes les pertinentes. */
	utilesAtteintes: number | null;
	/** Pertinentes parmi les 10 premières par `p` (le panneau), sur toutes les pertinentes. */
	rappel10: number | null;
};

export function simulerInjections(messages: readonly MessageNote[], r: ReglageDInjection = REGLAGE_PAR_DEFAUT): MesuresDInjection {
	const servis = servirLesMessages(messages, r);
	let injections = 0;
	let justes = 0;
	let nonJugees = 0;
	let horsPileFausses = 0;
	let silencesAvecInjection = 0;
	let pertinentes = 0;
	let atteintes = 0;
	let dans10 = 0;
	const sessions = new Set<string>();
	for (const { message: m, injectees, pistes } of servis) {
		injections += injectees.length;
		justes += injectees.filter((c) => c.statut === 'pertinente').length;
		nonJugees += injectees.filter((c) => c.statut === 'non_jugee').length;
		horsPileFausses += injectees.filter((c) => c.horsPile && c.statut !== 'pertinente').length;
		if (injectees.length > 0 && estReelle(m.session)) sessions.add(m.session);
		if (m.silence && injectees.length > 0) silencesAvecInjection += 1;
		pertinentes += m.candidates.filter((c) => c.statut === 'pertinente').length;
		atteintes += [...injectees, ...pistes].filter((c) => c.statut === 'pertinente').length;
		dans10 += [...m.candidates].sort((a, b) => b.p - a.p).slice(0, 10).filter((c) => c.statut === 'pertinente').length;
	}
	const silences = messages.filter((m) => m.silence);
	return {
		seuil: r.seuil,
		messages: messages.length,
		injections,
		justes,
		nonJugees,
		horsPileFausses,
		precision: part(justes, injections - nonJugees),
		precisionPessimiste: part(justes, injections),
		wilsonBassePessimiste: intervalleWilson(justes, injections).basse,
		sessions: sessions.size,
		injectionsParMessage: messages.length === 0 ? 0 : injections / messages.length,
		silences: silences.length,
		sessionsSilence: new Set(silences.map((m) => m.session).filter(estReelle)).size,
		silencesAvecInjection,
		partSilencesAvecInjection: part(silencesAvecInjection, silences.length),
		rappel: part(servis.reduce((n, s) => n + s.injectees.filter((c) => c.statut === 'pertinente').length, 0), pertinentes),
		utilesAtteintes: part(atteintes, pertinentes),
		rappel10: part(dans10, pertinentes),
	};
}

/** Une case de la grille des seuils : ce qui atteint la session, par message porteur. */
export type CaseDeSeuils = {
	seuil: number;
	seuilPiste: number;
	utilesInjectees: number;
	utilesEnPiste: number;
	/** Part des pertinentes injectées ou en piste. */
	partUtilesAtteintes: number | null;
	injectionsATort: number;
};

export const SEUILS_INJECTION_GRILLE = [0.7, 0.8, 0.9];
export const SEUILS_PISTE_GRILLE = [0.1, 0.15, 0.3];

/** Chaque seuil d'injection croisé avec chaque seuil de piste. */
export function grilleDesSeuils(messages: readonly MessageNote[], base: ReglageDInjection = REGLAGE_PAR_DEFAUT): CaseDeSeuils[] {
	const n = messages.length;
	const pertinentes = messages.reduce((s, m) => s + m.candidates.filter((c) => c.statut === 'pertinente').length, 0);
	return SEUILS_INJECTION_GRILLE.flatMap((seuil) =>
		SEUILS_PISTE_GRILLE.map((seuilPiste) => {
			const servis = servirLesMessages(messages, { ...base, seuil, seuilPiste });
			const utilesInjectees = servis.reduce((s, x) => s + x.injectees.filter((c) => c.statut === 'pertinente').length, 0);
			const utilesEnPiste = servis.reduce((s, x) => s + x.pistes.filter((c) => c.statut === 'pertinente').length, 0);
			const aTort = servis.reduce((s, x) => s + x.injectees.filter((c) => c.statut !== 'pertinente').length, 0);
			return {
				seuil,
				seuilPiste,
				utilesInjectees: n === 0 ? 0 : utilesInjectees / n,
				utilesEnPiste: n === 0 ? 0 : utilesEnPiste / n,
				partUtilesAtteintes: part(utilesInjectees + utilesEnPiste, pertinentes),
				injectionsATort: n === 0 ? 0 : aTort / n,
			};
		}),
	);
}

/**
 * Bootstrap groupé par session de la précision pessimiste : les sessions (la pseudo-session `manuel` comme une seule) sont
 * tirées avec remise, `tirages` fois, graine fixe ; rend le 2,5e centile. Un tirage sans injection est laissé. Null sans
 * injection.
 */
export function bootstrapPrecision(messages: readonly MessageNote[], r: ReglageDInjection = REGLAGE_PAR_DEFAUT, options: { tirages?: number; graine?: number } = {}): number | null {
	const parSession = new Map<string, { justes: number; injections: number }>();
	for (const { message: m, injectees } of servirLesMessages(messages, r)) {
		const s = parSession.get(m.session) ?? { justes: 0, injections: 0 };
		s.injections += injectees.length;
		s.justes += injectees.filter((c) => c.statut === 'pertinente').length;
		parSession.set(m.session, s);
	}
	const sessions = [...parSession.values()];
	if (sessions.every((s) => s.injections === 0)) return null;
	const u = hasardFixe(options.graine ?? 20261125);
	const precisions: number[] = [];
	for (let t = 0; t < (options.tirages ?? 2000); t++) {
		let justes = 0;
		let injections = 0;
		for (let i = 0; i < sessions.length; i++) {
			const s = sessions[Math.floor(u() * sessions.length)]!;
			justes += s.justes;
			injections += s.injections;
		}
		if (injections > 0) precisions.push(justes / injections);
	}
	precisions.sort((a, b) => a - b);
	return precisions[Math.floor(0.025 * precisions.length)] ?? null;
}

const pairesJugees = (messages: readonly MessageNote[]) =>
	messages.flatMap((m) => m.candidates.flatMap((c) => (c.statut === 'non_jugee' ? [] : [{ z: c.z, p: c.p, pertinente: c.statut === 'pertinente' }])));

/**
 * Pente de calibration : régression logistique du jugement sur la marge `z` notée hors pli, sur toutes les paires jugées. Une
 * note bien calibrée a une pente proche de 1 et une ordonnée proche de 0 ; sous 1, elle est trop sûre d'elle. Null sans les
 * deux jugements.
 */
export function penteDeCalibration(messages: readonly MessageNote[]): { pente: number; ordonnee: number } | null {
	const paires = pairesJugees(messages);
	if (!paires.some((x) => x.pertinente) || paires.every((x) => x.pertinente)) return null;
	const r = apprendreRegression(
		paires.map((x) => ({ x: [x.z], y: x.pertinente })),
		{ lambda: 0, positifs: false },
	);
	return { pente: r.poids[0]!, ordonnee: r.biais };
}

/** Table de fiabilité et ECE (p ≥ 0,5) sur toutes les paires jugées : rapportées, pas un critère. */
export function calibration(messages: readonly MessageNote[]): { ece: number | null; fiabilite: TrancheFiabilite[] } {
	const paires = pairesJugees(messages);
	return { ece: eceDe(paires), fiabilite: tableDeFiabilite(paires) };
}

/** Mesures d'acceptation d'une note : la simulation au seuil, le bootstrap, la calibration. */
export type MesuresDAcceptation = MesuresDInjection & { bootstrapP025: number | null; pente: number | null; ordonnee: number | null; ece: number | null };

export function mesurerAcceptation(messages: readonly MessageNote[], r: ReglageDInjection = REGLAGE_PAR_DEFAUT): MesuresDAcceptation {
	const pente = penteDeCalibration(messages);
	return {
		...simulerInjections(messages, r),
		bootstrapP025: bootstrapPrecision(messages, r),
		pente: pente?.pente ?? null,
		ordonnee: pente?.ordonnee ?? null,
		ece: calibration(messages).ece,
	};
}

/** Critères d'acceptation (spec § 4.3, revus le 25/11), au seuil par défaut. */
export const CRITERES = {
	injectionsMin: 25,
	sessionsMin: 10,
	precisionMin: 0.9,
	wilsonBasseMin: 0.8,
	bootstrapMin: 0.8,
	penteMin: 0.8,
	penteMax: 1.25,
	silencesMin: 20,
	sessionsSilenceMin: 5,
	partSilencesMax: 0.05,
	injectionsParMessageMax: 0.5,
} as const;

const pc = (x: number) => `${Math.round(x * 1000) / 10} %`;

/** Le modèle est-il accepté ? `refus` : chaque critère manqué, en clair (aucun texte de fiche). */
export function accepter(m: MesuresDAcceptation): { accepte: boolean; refus: string[] } {
	const c = CRITERES;
	const refus: string[] = [];
	if (m.injections < c.injectionsMin) refus.push(`${m.injections} injections simulées (au moins ${c.injectionsMin})`);
	if (m.sessions < c.sessionsMin) refus.push(`${m.sessions} sessions réelles servies (au moins ${c.sessionsMin})`);
	if (m.precisionPessimiste === null || m.precisionPessimiste < c.precisionMin) {
		refus.push(`précision ${m.precisionPessimiste === null ? '-' : pc(m.precisionPessimiste)} (au moins ${pc(c.precisionMin)})`);
	}
	if (m.wilsonBassePessimiste < c.wilsonBasseMin) refus.push(`borne basse de Wilson ${pc(m.wilsonBassePessimiste)} (au moins ${pc(c.wilsonBasseMin)})`);
	if (m.bootstrapP025 === null || m.bootstrapP025 < c.bootstrapMin) {
		refus.push(`précision au 2,5e centile du bootstrap ${m.bootstrapP025 === null ? '-' : pc(m.bootstrapP025)} (au moins ${pc(c.bootstrapMin)})`);
	}
	if (m.pente === null || m.pente < c.penteMin || m.pente > c.penteMax) {
		refus.push(`pente de calibration ${m.pente === null ? '-' : m.pente.toFixed(2)} (entre ${c.penteMin} et ${c.penteMax})`);
	}
	if (m.silences < c.silencesMin || m.sessionsSilence < c.sessionsSilenceMin) {
		refus.push(`pas assez de messages silence : ${m.silences} de ${m.sessionsSilence} sessions réelles (au moins ${c.silencesMin} de ${c.sessionsSilenceMin})`);
	} else if (m.partSilencesAvecInjection !== null && m.partSilencesAvecInjection > c.partSilencesMax) {
		refus.push(`${pc(m.partSilencesAvecInjection)} des messages silence servis (au plus ${pc(c.partSilencesMax)})`);
	}
	if (m.injectionsParMessage > c.injectionsParMessageMax) refus.push(`${m.injectionsParMessage.toFixed(2)} injection par message (au plus ${c.injectionsParMessageMax})`);
	return { accepte: refus.length === 0, refus };
}
