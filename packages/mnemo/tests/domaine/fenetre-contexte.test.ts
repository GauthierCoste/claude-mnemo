import { describe, expect, it } from 'vitest';
import { fenetreDeContexte } from '../../src/domaine/moteurs/claude-code/fenetre-contexte.ts';

const reponse = (tokens: number): string => JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: tokens } } });

describe('fenetreDeContexte', () => {
	it('sans seuil : 200 000 puis 1 000 000 au-delà', () => {
		expect(fenetreDeContexte([reponse(150_000)])).toEqual({ utilises: 150_000, max: 200_000 });
		expect(fenetreDeContexte([reponse(365_000)])).toEqual({ utilises: 365_000, max: 1_000_000 });
	});

	it('avec un seuil de résumé automatique : le seuil est le maximum', () => {
		expect(fenetreDeContexte([reponse(365_000)], 400_000)).toEqual({ utilises: 365_000, max: 400_000, avantResume: true });
	});

	it('au-delà du seuil : le maximum reste le seuil', () => {
		expect(fenetreDeContexte([reponse(420_000)], 400_000)).toEqual({ utilises: 420_000, max: 400_000, avantResume: true });
	});

	it('un seuil invalide est ignoré', () => {
		for (const seuil of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
			expect(fenetreDeContexte([reponse(365_000)], seuil)).toEqual({ utilises: 365_000, max: 1_000_000 });
		}
	});

	it('null sans réponse de Claude', () => {
		expect(fenetreDeContexte(['{"type":"user"}'], 400_000)).toBeNull();
	});
});
