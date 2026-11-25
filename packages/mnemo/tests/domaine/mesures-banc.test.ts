import { describe, expect, it } from 'vitest';
import { ece, intervalleWilson, plisParSession, tableDeFiabilite } from '../../src/domaine/mesures-banc.ts';

describe('intervalleWilson', () => {
	it('valeurs connues à 95 %', () => {
		expect(intervalleWilson(9, 10).basse).toBeCloseTo(0.5958, 3);
		expect(intervalleWilson(9, 10).haute).toBeCloseTo(0.9821, 3);
		expect(intervalleWilson(50, 50).basse).toBeCloseTo(0.9287, 3);
		expect(intervalleWilson(0, 20).basse).toBe(0);
	});

	it('la borne basse monte avec le nombre d’essais à proportion égale', () => {
		expect(intervalleWilson(90, 100).basse).toBeGreaterThan(intervalleWilson(9, 10).basse);
		expect(intervalleWilson(90, 100).basse).toBeCloseTo(0.8256, 3);
	});

	it('sans essai : rien n’est prouvé', () => {
		expect(intervalleWilson(0, 0)).toEqual({ basse: 0, haute: 1 });
	});
});

describe('tableDeFiabilite et ece', () => {
	it('range chaque paire dans sa tranche ; p = 1 tombe dans la dernière', () => {
		const table = tableDeFiabilite([{ p: 0.05, pertinente: false }, { p: 0.95, pertinente: true }, { p: 1, pertinente: false }]);
		expect(table).toHaveLength(10);
		expect(table[0]).toMatchObject({ paires: 1, frequence: 0 });
		expect(table[9]).toMatchObject({ paires: 2, frequence: 0.5 });
		expect(table[9]!.pMoyen).toBeCloseTo(0.975);
	});

	it('ECE nulle pour une note parfaitement calibrée', () => {
		const paires = [...Array.from({ length: 9 }, () => ({ p: 0.9, pertinente: true })), { p: 0.9, pertinente: false }];
		expect(ece(paires)).toBeCloseTo(0);
	});

	it('ECE : écart moyen pondéré, sur les seules paires où p ≥ 0,5', () => {
		const paires = [
			// tranche 0,9 : p 0,9, 2 sur 4 pertinentes → écart 0,4 ; tranche 0,6 : p 0,6, toutes pertinentes → écart 0,4
			...Array.from({ length: 4 }, (_, i) => ({ p: 0.9, pertinente: i < 2 })),
			...Array.from({ length: 4 }, () => ({ p: 0.6, pertinente: true })),
			// ignorées : sous 0,5
			...Array.from({ length: 10 }, () => ({ p: 0.1, pertinente: true })),
		];
		expect(ece(paires)).toBeCloseTo(0.4);
		expect(ece([{ p: 0.2, pertinente: true }])).toBeNull();
	});
});

describe('plisParSession', () => {
	const elements = ['a', 'a', 'a', 'b', 'b', 'c', 'd', 'd', 'e', 'f', 'g', 'g', 'g', 'g', 'h'].map((session) => ({ session }));

	it('aucun pli ne coupe une session', () => {
		const plis = plisParSession(elements, 5);
		const pliDe = new Map<string, Set<number>>();
		elements.forEach((e, i) => pliDe.set(e.session, (pliDe.get(e.session) ?? new Set()).add(plis[i]!)));
		for (const plisDeLaSession of pliDe.values()) expect(plisDeLaSession.size).toBe(1);
	});

	it('plis équilibrés, tous dans [0, k − 1], déterministes', () => {
		const plis = plisParSession(elements, 5);
		expect(plis.every((p) => p >= 0 && p < 5)).toBe(true);
		const tailles = [0, 1, 2, 3, 4].map((k) => plis.filter((p) => p === k).length);
		expect(Math.max(...tailles) - Math.min(...tailles)).toBeLessThanOrEqual(2);
		expect(plisParSession([...elements].reverse(), 5)).toEqual([...plis].reverse());
	});

	it('k invalide : erreur', () => {
		expect(() => plisParSession(elements, 0)).toThrow('plis');
	});
});
