import { describe, expect, it } from 'vitest';
import { decisionSurInactivite } from '../../src/infra/modeles/gardien.ts';

const QUINZE_MINUTES = 15 * 60_000;

describe('decisionSurInactivite', () => {
	it('s’arrête après le temps d’inactivité, et seulement alors (le service n’y est pour rien)', () => {
		expect(decisionSurInactivite({ inactifDepuisMs: QUINZE_MINUTES - 1, inactiviteMs: QUINZE_MINUTES })).toEqual({ arreter: false });
		expect(decisionSurInactivite({ inactifDepuisMs: QUINZE_MINUTES + 1, inactiviteMs: QUINZE_MINUTES })).toEqual({ arreter: true, motif: '900 s sans requête' });
	});
});
