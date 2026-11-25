import { describe, expect, it } from 'vitest';
import { accepter, calibration, REGLAGE_PAR_DEFAUT, simulerInjections } from '../../src/domaine/acceptation-note.ts';
import type { CandidateNotee, MesuresDInjection, MessageNote } from '../../src/domaine/acceptation-note.ts';

const c = (p: number, statut: CandidateNotee['statut'], extra: Partial<CandidateNotee> = {}): CandidateNotee => ({ p, pSansApriori: p, statut, horsPile: false, ...extra });
const m = (session: string, candidates: CandidateNotee[], silence = false): MessageNote => ({ session, silence, candidates });

describe('simulerInjections', () => {
	it('injecte au plus 2 fiches au-dessus du seuil, les mieux notées ; les non jugées comptent fausses en pessimiste', () => {
		const r = simulerInjections([
			m('a', [c(0.99, 'pertinente'), c(0.95, 'non_jugee'), c(0.93, 'pertinente'), c(0.5, 'pertinente')]),
			m('b', [c(0.92, 'non_pertinente'), c(0.2, 'non_pertinente')]),
			m('c', [c(0.4, 'pertinente')]),
		]);
		expect(r).toMatchObject({ messages: 3, injections: 3, justes: 1, nonJugees: 1, sessions: 2, injectionsParMessage: 1 });
		expect(r.precision).toBe(0.5);
		expect(r.precisionPessimiste).toBeCloseTo(1 / 3);
		// 1 retrouvée sur 4 pertinentes (0,93 est la troisième au-dessus du seuil : hors du plafond)
		expect(r.rappel).toBe(0.25);
	});

	it('garde de l’a priori : p sans a priori sous 0,7, rien n’est injecté', () => {
		const r = simulerInjections([m('a', [c(0.95, 'pertinente', { pSansApriori: 0.6 })])]);
		expect(r.injections).toBe(0);
	});

	it('les fiches hors pile ne sont jamais injectées, mais comptent au rappel', () => {
		const r = simulerInjections([m('a', [c(0.99, 'pertinente', { horsPile: true }), c(0.97, 'non_pertinente', { horsPile: true }), c(0.91, 'pertinente')])]);
		expect(r).toMatchObject({ injections: 1, justes: 1, rappel: 1 });
	});

	it('compte les messages silence servis', () => {
		const r = simulerInjections([m('a', [c(0.95, 'non_pertinente')], true), m('b', [c(0.3, 'non_pertinente')], true), m('c', [c(0.95, 'pertinente')])]);
		expect(r).toMatchObject({ silences: 2, silencesAvecInjection: 1, partSilencesAvecInjection: 0.5 });
	});

	it('abstention : rien dans un message où la coupure est floue', () => {
		const messages = [m('a', [c(0.95, 'pertinente'), c(0.94, 'non_pertinente'), c(0.93, 'non_pertinente')]), m('b', [c(0.97, 'pertinente'), c(0.5, 'non_pertinente')])];
		const sans = simulerInjections(messages);
		const avec = simulerInjections(messages, { ...REGLAGE_PAR_DEFAUT, abstention: 0.05 });
		expect(sans.injections).toBe(3);
		expect(avec).toMatchObject({ injections: 1, justes: 1, abstenus: 1 });
	});
});

describe('calibration', () => {
	it('ECE sur les paires jugées de la pile seulement', () => {
		const messages = [m('a', [c(0.95, 'pertinente'), c(0.95, 'pertinente'), c(0.95, 'non_jugee'), c(0.95, 'non_pertinente', { horsPile: true })])];
		expect(calibration(messages).ece).toBeCloseTo(0.05);
	});
});

describe('accepter', () => {
	const bonnes: MesuresDInjection = {
		seuil: 0.9,
		messages: 200,
		injections: 80,
		justes: 78,
		nonJugees: 0,
		precision: 78 / 80,
		precisionPessimiste: 78 / 80,
		wilsonBasse: 0.91,
		wilsonBassePessimiste: 0.91,
		sessions: 25,
		injectionsParMessage: 0.4,
		silences: 30,
		silencesAvecInjection: 1,
		partSilencesAvecInjection: 1 / 30,
		rappel: 0.4,
		abstenus: 0,
	};

	it('accepte quand tous les critères tiennent', () => {
		expect(accepter(bonnes, 0.03)).toEqual({ accepte: true, refus: [] });
	});

	it('refuse sous 50 injections ou 20 sessions, malgré une précision parfaite', () => {
		expect(accepter({ ...bonnes, injections: 49, justes: 49, precisionPessimiste: 1 }, 0.01).refus).toEqual(['49 injections simulées (au moins 50)']);
		expect(accepter({ ...bonnes, sessions: 19 }, 0.01).refus).toEqual(['19 sessions servies (au moins 20)']);
	});

	it('refuse sur chacun des autres critères', () => {
		expect(accepter({ ...bonnes, precisionPessimiste: 0.89 }, 0.01).accepte).toBe(false);
		expect(accepter({ ...bonnes, wilsonBassePessimiste: 0.84 }, 0.01).accepte).toBe(false);
		expect(accepter(bonnes, 0.06).accepte).toBe(false);
		expect(accepter(bonnes, null).accepte).toBe(false);
		expect(accepter({ ...bonnes, partSilencesAvecInjection: 0.06 }, 0.01).accepte).toBe(false);
		expect(accepter({ ...bonnes, injectionsParMessage: 0.51 }, 0.01).accepte).toBe(false);
		// sans message silence, ce critère ne peut pas manquer
		expect(accepter({ ...bonnes, partSilencesAvecInjection: null }, 0.01).accepte).toBe(true);
	});
});
