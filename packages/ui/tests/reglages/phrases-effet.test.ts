import { describe, expect, it } from 'vitest';
import { remarqueSeuilInjection } from '../../src/reglages/phrases-effet.ts';

describe('remarque sous le seuil d’injection', () => {
	it('note refusée ou de départ : sans effet, quel que soit le seuil', () => {
		expect(remarqueSeuilInjection(80, [{ etat: 'refuse', seuil: 0.9 }, { etat: 'depart', seuil: null }])).toMatch(/^Sans effet pour l’instant/u);
	});

	it('note acceptée mesurée à un autre seuil : la réapprendre ; au même seuil : rien', () => {
		expect(remarqueSeuilInjection(80, [{ etat: 'accepte', seuil: 0.9 }])).toBe('Note mesurée à 90 % : la réapprendre pour la mesurer à 80 %.');
		expect(remarqueSeuilInjection(90, [{ etat: 'accepte', seuil: 0.9 }])).toBeNull();
	});

	it('jamais d’injection (100 %) ou état inconnu : rien', () => {
		expect(remarqueSeuilInjection(100, [{ etat: 'refuse', seuil: 0.9 }])).toBeNull();
		expect(remarqueSeuilInjection(80, undefined)).toBeNull();
	});
});
