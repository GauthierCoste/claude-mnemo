import { describe, expect, it } from 'vitest';
import { accepter, bootstrapPrecision, grilleDesSeuils, penteDeCalibration, SESSION_MANUELLE, simulerInjections } from '../../src/domaine/acceptation-note.ts';
import type { CandidateNotee, MesuresDAcceptation, MessageNote } from '../../src/domaine/acceptation-note.ts';

let numero = 0;
const c = (p: number, statut: CandidateNotee['statut'], extra: Partial<CandidateNotee> = {}): CandidateNotee => ({
	chemin: `notes/Fiche ${(numero += 1)}.md`,
	z: Math.log(p / (1 - p)),
	p,
	pSansApriori: p,
	statut,
	horsPile: false,
	injectable: true,
	...extra,
});
const m = (session: string, candidates: CandidateNotee[], options: { silence?: boolean; rang?: number } = {}): MessageNote => ({
	session,
	rang: options.rang ?? 1,
	silence: options.silence ?? false,
	candidates,
});

describe('simulerInjections', () => {
	it('trois fiches à 0,99 : deux injections (le plafond)', () => {
		const r = simulerInjections([m('a', [c(0.99, 'pertinente'), c(0.995, 'pertinente'), c(0.99, 'pertinente')])]);
		expect(r).toMatchObject({ injections: 2, justes: 2, sessions: 1 });
	});

	it('une indécise (non jugée) à 0,97 injectée compte fausse', () => {
		const r = simulerInjections([m('a', [c(0.97, 'non_jugee'), c(0.95, 'pertinente')])]);
		expect(r).toMatchObject({ injections: 2, justes: 1, nonJugees: 1 });
		expect(r.precisionPessimiste).toBe(0.5);
		expect(r.precision).toBe(1);
	});

	it('la même fiche n’est jamais injectée deux fois dans une session', () => {
		const meme = (rang: number, session = 'a') => m(session, [c(0.98, 'pertinente', { chemin: 'notes/Corvel.md' })], { rang });
		expect(simulerInjections([meme(2), meme(1), meme(3)])).toMatchObject({ injections: 1, justes: 1 });
		// d'une session à l'autre, elle repart ; les cas étiquetés à la main sont indépendants
		expect(simulerInjections([meme(1), meme(1, 'b')]).injections).toBe(2);
		expect(simulerInjections([meme(1, SESSION_MANUELLE), meme(2, SESSION_MANUELLE)]).injections).toBe(2);
	});

	it('une fiche hors pile à forte note, non pertinente, est injectée et comptée fausse', () => {
		const r = simulerInjections([m('a', [c(0.99, 'non_pertinente', { horsPile: true }), c(0.4, 'pertinente')])]);
		expect(r).toMatchObject({ injections: 1, justes: 0, horsPileFausses: 1 });
	});

	it('seules les injectables sont injectées ; garde de l’a priori', () => {
		expect(simulerInjections([m('a', [c(0.99, 'pertinente', { injectable: false })])]).injections).toBe(0);
		expect(simulerInjections([m('a', [c(0.95, 'pertinente', { pSansApriori: 0.6 })])]).injections).toBe(0);
	});

	it('silences servis, sessions réelles, rappel, utiles atteintes et 10 premières', () => {
		const r = simulerInjections([
			m('a', [c(0.95, 'non_pertinente')], { silence: true }),
			m('b', [c(0.3, 'non_pertinente')], { silence: true }),
			m(SESSION_MANUELLE, [c(0.95, 'pertinente'), c(0.7, 'pertinente'), c(0.05, 'pertinente')]),
		]);
		expect(r).toMatchObject({ silences: 2, sessionsSilence: 2, silencesAvecInjection: 1, partSilencesAvecInjection: 0.5, sessions: 1 });
		expect(r.rappel).toBeCloseTo(1 / 3);
		expect(r.utilesAtteintes).toBeCloseTo(2 / 3);
		expect(r.rappel10).toBe(1);
	});
});

describe('grilleDesSeuils', () => {
	it('chaque seuil d’injection croisé avec chaque seuil de piste', () => {
		const g = grilleDesSeuils([m('a', [c(0.85, 'pertinente'), c(0.5, 'pertinente'), c(0.2, 'pertinente'), c(0.75, 'non_pertinente')])]);
		expect(g).toHaveLength(9);
		expect(g.find((x) => x.seuil === 0.8 && x.seuilPiste === 0.15)).toMatchObject({ utilesInjectees: 1, utilesEnPiste: 2, partUtilesAtteintes: 1, injectionsATort: 0 });
		expect(g.find((x) => x.seuil === 0.7 && x.seuilPiste === 0.3)).toMatchObject({ utilesInjectees: 1, utilesEnPiste: 1, injectionsATort: 1 });
	});
});

describe('bootstrapPrecision', () => {
	it('groupé par session, déterministe ; une session fausse pèse de tout son poids', () => {
		const justes = Array.from({ length: 19 }, (_, i) => m(`s${i}`, [c(0.95, 'pertinente')]));
		const fausse = m('x', [c(0.95, 'non_pertinente'), c(0.95, 'non_pertinente')]);
		const b = bootstrapPrecision([...justes, fausse]);
		expect(b).toBe(bootstrapPrecision([...justes, fausse]));
		expect(b!).toBeLessThan(19 / 21);
		expect(bootstrapPrecision(justes)).toBe(1);
		expect(bootstrapPrecision([m('a', [c(0.2, 'pertinente')])])).toBeNull();
	});
});

describe('penteDeCalibration', () => {
	it('proche de 1 pour une note calibrée, sous 1 pour une note trop sûre d’elle', () => {
		const u = (i: number) => (Math.sin(i * 12.9898) * 43758.5453) % 1;
		const paires = Array.from({ length: 4000 }, (_, i) => {
			const z = -4 + 8 * Math.abs(u(i));
			return { z, y: Math.abs(u(i + 100_000)) < 1 / (1 + Math.exp(-z)) };
		});
		const messages = (echelle: number) => [m('a', paires.map(({ z, y }) => c(1 / (1 + Math.exp(-z * echelle)), y ? 'pertinente' : 'non_pertinente', { z: z * echelle })))];
		expect(penteDeCalibration(messages(1))!.pente).toBeGreaterThan(0.85);
		expect(penteDeCalibration(messages(1))!.pente).toBeLessThan(1.15);
		expect(penteDeCalibration(messages(2))!.pente).toBeLessThan(0.6);
		expect(penteDeCalibration([m('a', [c(0.9, 'pertinente')])])).toBeNull();
	});
});

describe('accepter', () => {
	const bonnes: MesuresDAcceptation = {
		seuil: 0.9,
		messages: 140,
		injections: 40,
		justes: 39,
		nonJugees: 0,
		horsPileFausses: 0,
		precision: 39 / 40,
		precisionPessimiste: 39 / 40,
		wilsonBassePessimiste: 0.87,
		sessions: 15,
		injectionsParMessage: 0.3,
		silences: 30,
		sessionsSilence: 12,
		silencesAvecInjection: 1,
		partSilencesAvecInjection: 1 / 30,
		rappel: 0.4,
		utilesAtteintes: 0.6,
		rappel10: 0.9,
		bootstrapP025: 0.9,
		pente: 1.05,
		ordonnee: 0.1,
		ece: 0.2,
	};

	it('accepte quand tous les critères tiennent ; l’ECE n’en est plus un', () => {
		expect(accepter(bonnes)).toEqual({ accepte: true, refus: [] });
	});

	it('refuse sous 25 injections ou 10 sessions réelles', () => {
		expect(accepter({ ...bonnes, injections: 24 }).refus).toEqual(['24 injections simulées (au moins 25)']);
		expect(accepter({ ...bonnes, sessions: 9 }).refus).toEqual(['9 sessions réelles servies (au moins 10)']);
	});

	it('refuse sur chacun des autres critères', () => {
		expect(accepter({ ...bonnes, precisionPessimiste: 0.89 }).accepte).toBe(false);
		expect(accepter({ ...bonnes, wilsonBassePessimiste: 0.79 }).accepte).toBe(false);
		expect(accepter({ ...bonnes, bootstrapP025: 0.79 }).accepte).toBe(false);
		expect(accepter({ ...bonnes, bootstrapP025: null }).accepte).toBe(false);
		expect(accepter({ ...bonnes, pente: 0.79 }).accepte).toBe(false);
		expect(accepter({ ...bonnes, pente: 1.26 }).accepte).toBe(false);
		expect(accepter({ ...bonnes, partSilencesAvecInjection: 0.06 }).accepte).toBe(false);
		expect(accepter({ ...bonnes, injectionsParMessage: 0.51 }).accepte).toBe(false);
	});

	it('refuse sans assez de messages silence', () => {
		expect(accepter({ ...bonnes, silences: 19 }).refus[0]).toMatch(/^pas assez de messages silence/u);
		expect(accepter({ ...bonnes, sessionsSilence: 4 }).refus[0]).toMatch(/^pas assez de messages silence/u);
	});
});
