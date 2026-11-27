import { describe, expect, it } from 'vitest';
import { TEXTES } from '../../src/langue/textes.ts';
import { dureeDepuis } from '../../src/sessions/etats.ts';

const MIN = 60_000;
const H = 60 * MIN;
const J = 24 * H;
const T = 1_800_000_000_000;

describe('états des sessions', () => {
	it('libellés des états', () => {
		expect(TEXTES.fr.sessions.etats).toEqual({ attend: 'Attend une réponse', travaille: 'Travaille', a_relire: 'Terminée, à relire', en_pause: 'En pause', terminee: 'Terminée' });
	});

	it('dureeDepuis : minutes, heures, jours', () => {
		expect(dureeDepuis(T - 18 * MIN, T)).toBe('18 min');
		expect(dureeDepuis(T - 20_000, T)).toBe('0 min');
		expect(dureeDepuis(T - (H + 10 * MIN), T)).toBe('1 h 10');
		expect(dureeDepuis(T - (2 * H + 5 * MIN), T)).toBe('2 h 05');
		expect(dureeDepuis(T - 3 * H, T)).toBe('3 h');
		expect(dureeDepuis(T - (J + 4 * H + 20 * MIN), T)).toBe('1 j 4 h');
		expect(dureeDepuis(T - 2 * J, T)).toBe('2 j');
		expect(dureeDepuis(T + MIN, T)).toBe('0 min');
	});

	it('dureeDepuis en pause : « 3 j sans activité »', () => {
		expect(dureeDepuis(T - (3 * J + 5 * H), T, 'en_pause')).toBe('3 j sans activité');
		expect(dureeDepuis(T - (5 * H + 9 * MIN), T, 'en_pause')).toBe('5 h sans activité');
		expect(dureeDepuis(T - 12 * MIN, T, 'en_pause')).toBe('12 min sans activité');
	});
});
