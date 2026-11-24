import { describe, expect, it } from 'vitest';
import { baseDuReranker, classer, designees, noter, signalDominant } from '../../src/domaine/note-des-pistes.ts';
import type { Signal } from '../../src/domaine/note-des-pistes.ts';

/** Signal fictif : un poids fixe par fiche. */
const signal = (poids: Record<string, number>, depuis = 'x.md'): Signal => ({
	nom: 'liee',
	apport: (chemin) => (poids[chemin] === undefined ? null : { signal: 'liee', poids: poids[chemin]!, depuis }),
	designees: new Set(Object.keys(poids)),
});

describe('noter', () => {
	it('note = base + somme des poids ; un apport nul est ignoré', () => {
		const n = noter('a.md', 0.3, [signal({ 'a.md': 0.25 }), signal({ 'a.md': 0.1 }), signal({ 'a.md': 0 })]);
		expect(n.base).toBe(0.3);
		expect(n.apports).toHaveLength(2);
		expect(n.total).toBeCloseTo(0.65, 10);
		expect(noter('b.md', 0.3, [signal({ 'a.md': 0.25 })])).toEqual({ chemin: 'b.md', base: 0.3, apports: [], total: 0.3 });
	});

	it('sans signal : la note est la base', () => {
		expect(noter('a.md', 0, []).total).toBe(0);
	});
});

describe('classer', () => {
	it('note décroissante, puis le départage', () => {
		const s = [signal({ 'c.md': 0.25 })];
		const notes = [noter('a.md', 0.5, s), noter('b.md', 0.5, s), noter('c.md', 0.4, s)];
		expect(classer(notes, (a, b) => a.chemin.localeCompare(b.chemin)).map((n) => n.chemin)).toEqual(['c.md', 'a.md', 'b.md']);
		expect(classer(notes, (a, b) => b.chemin.localeCompare(a.chemin)).map((n) => n.chemin)).toEqual(['c.md', 'b.md', 'a.md']);
	});
});

describe('signalDominant', () => {
	it('le signal qui pèse le plus, s’il pèse plus que la base ; sinon null', () => {
		expect(signalDominant(noter('a.md', 0.1, [signal({ 'a.md': 0.25 }, 'p.md')]))).toEqual({ signal: 'liee', poids: 0.25, depuis: 'p.md' });
		expect(signalDominant(noter('a.md', 0.6, [signal({ 'a.md': 0.25 })]))).toBeNull();
		expect(signalDominant(noter('a.md', 0, []))).toBeNull();
	});
});

describe('designees', () => {
	it('réunit les fiches désignées par les signaux', () => {
		expect(designees([signal({ 'a.md': 0.1 }), signal({ 'b.md': 0.1 })])).toEqual(new Set(['a.md', 'b.md']));
	});
});

describe('baseDuReranker', () => {
	it('la note brute (logit) par la sigmoïde : dans [0, 1], dans le même ordre', () => {
		expect(baseDuReranker(0)).toBe(0.5);
		expect(baseDuReranker(3)).toBeCloseTo(0.9526, 4);
		expect(baseDuReranker(-1)).toBeCloseTo(0.2689, 4);
	});

	it('échelle absolue : une candidate seule ne vaut pas 1, deux candidates proches gardent des bases proches', () => {
		// une seule candidate, de note médiocre : sa base reste médiocre (pas 1 parce qu'elle est la meilleure)
		expect(baseDuReranker(-2)).toBeCloseTo(0.1192, 4);
		// deux candidates proches : pas de base binaire (1 et 0), leur écart reste petit et un poids de 0,25 les départage
		const [haute, basse] = [baseDuReranker(0.2), baseDuReranker(0.1)];
		expect(haute - basse).toBeGreaterThan(0);
		expect(haute - basse).toBeLessThan(0.05);
		expect(basse + 0.25).toBeGreaterThan(haute);
	});
});
