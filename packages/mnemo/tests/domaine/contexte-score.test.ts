import { describe, expect, it } from 'vitest';
import { sigmoide } from '../../src/domaine/contexte-score.ts';

describe('sigmoide', () => {
	it('ramène une note brute entre 0 et 1', () => {
		expect(sigmoide(0)).toBe(0.5);
		expect(sigmoide(10)).toBeGreaterThan(0.99);
	});
});
