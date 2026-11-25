import { describe, expect, it } from 'vitest';
import { GARDE_APRIORI, injectables } from '../../src/domaine/injection-automatique.ts';
import type { NoteDeLaCandidate } from '../../src/domaine/note-de-confiance.ts';

const n = (p: number, surcharge: Partial<NoteDeLaCandidate> = {}): NoteDeLaCandidate => ({ p, pSansApriori: p, niveau: 'sens', accepte: true, ...surcharge });

describe('injectables', () => {
	const notes = new Map<string, NoteDeLaCandidate | null>([
		['a', n(0.91)],
		['b', n(0.97)],
		['c', n(0.89)],
		['d', n(0.99, { accepte: false })],
		['e', n(0.95, { pSansApriori: GARDE_APRIORI - 0.01 })],
		['f', null],
		['g', n(0.93)],
		['h', n(0.98, { coupee: true })],
	]);
	const tout = [...notes.keys()];
	it('accepté, au seuil, garde de l’a priori, non vue ; p décroissant', () => {
		expect(injectables(tout, (c) => notes.get(c), 90, (c) => c === 'g')).toEqual(['b', 'a']);
	});
	it('seuil 100 : aucune ; seuil 50 : plus', () => {
		expect(injectables(tout, (c) => notes.get(c), 100, () => false)).toEqual([]);
		expect(injectables(tout, (c) => notes.get(c), 50, () => false)).toEqual(['b', 'g', 'a', 'c']);
	});
	it('à p égal, l’ordre donné', () => {
		expect(injectables(['x', 'y'], () => n(0.95), 90, () => false)).toEqual(['x', 'y']);
	});
});
