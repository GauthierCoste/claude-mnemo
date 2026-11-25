import { describe, expect, it } from 'vitest';
import { bm25Relatif, bm25RelatifsDesListes, cosinusDesFiches, cosinusRelatif, cosinusZ, mediane, meilleurBm25, moyenneEtEcartType } from '../../src/domaine/signaux-de-note.ts';

describe('mediane', () => {
	it('impaire, paire, vide', () => {
		expect(mediane([3, 1, 2])).toBe(2);
		expect(mediane([4, 1, 3, 2])).toBe(2.5);
		expect(mediane([])).toBeNull();
	});
});

describe('cosinusDesFiches', () => {
	it('la première similarité de chaque fiche, et leur médiane', () => {
		const { parFiche, mediane: m } = cosinusDesFiches([
			{ chemin: 'a.md', similarite: 0.9 },
			{ chemin: 'b.md', similarite: 0.7 },
			{ chemin: 'a.md', similarite: 0.1 },
			{ chemin: 'c.md', similarite: 0.6 },
		]);
		expect([...parFiche]).toEqual([
			['a.md', 0.9],
			['b.md', 0.7],
			['c.md', 0.6],
		]);
		expect(m).toBe(0.7);
	});

	it('le cosinus relatif ne dépend que de la fiche et de la médiane de toute la mémoire', () => {
		expect(cosinusRelatif(0.9, 0.7)).toBeCloseTo(0.2, 12);
		expect(cosinusRelatif(null, 0.7)).toBeNull();
		expect(cosinusRelatif(0.9, null)).toBeNull();
	});
});

describe('cosinus relatif, variante z-score', () => {
	it('moyenne et écart-type de la population ; null pour une liste vide', () => {
		expect(moyenneEtEcartType([2, 4, 4, 4, 5, 5, 7, 9])).toEqual({ moyenne: 5, ecartType: 2 });
		expect(moyenneEtEcartType([])).toBeNull();
	});

	it('l’écart à la moyenne de toute la mémoire, en écarts-types', () => {
		const cos = cosinusDesFiches([
			{ chemin: 'a.md', similarite: 0.9 },
			{ chemin: 'b.md', similarite: 0.7 },
			{ chemin: 'c.md', similarite: 0.5 },
		]);
		expect(cos.moyenne).toBeCloseTo(0.7, 12);
		expect(cos.ecartType).toBeCloseTo(Math.sqrt(0.08 / 3), 12);
		expect(cosinusZ(0.9, cos)).toBeCloseTo(0.2 / Math.sqrt(0.08 / 3), 9);
		expect(cosinusZ(0.7, cos)).toBeCloseTo(0, 12);
		expect(cosinusZ(null, cos)).toBeNull();
		expect(cosinusZ(0.9, null)).toBeNull();
	});

	it('cosinus tous égaux : pas de z-score (l’écart-type ne dirait rien)', () => {
		const cos = cosinusDesFiches([
			{ chemin: 'a.md', similarite: 0.7 },
			{ chemin: 'b.md', similarite: 0.7 },
			{ chemin: 'c.md', similarite: 0.7 },
		]);
		expect(cosinusZ(0.7, cos)).toBeNull();
		expect(cosinusZ(0.7, cosinusDesFiches([]))).toBeNull();
	});

	it('médiane et z-score ne dépendent pas du nombre de candidates : la fiche, et toute la mémoire pour le message', () => {
		// une mémoire, une requête : les mêmes cosinus, que l’on classe 2 candidates ou 4
		const memoire = [0.91, 0.84, 0.8, 0.77, 0.74, 0.7, 0.66, 0.62].map((similarite, i) => ({ chemin: `f${i}.md`, similarite }));
		const cos = cosinusDesFiches(memoire);
		const signaux = (candidates: string[]) => candidates.map((c) => [c, cosinusRelatif(cos.parFiche.get(c)!, cos.mediane), cosinusZ(cos.parFiche.get(c)!, cos)]);
		const deux = signaux(['f0.md', 'f5.md']);
		const quatre = signaux(['f0.md', 'f2.md', 'f5.md', 'f7.md']);
		expect(quatre.filter(([c]) => c === 'f0.md' || c === 'f5.md')).toEqual(deux);
	});
});

describe('bm25 relatif', () => {
	it('rapporté au meilleur (le plus négatif) de la liste, dans [0, 1]', () => {
		expect(meilleurBm25([-2, -8, undefined, 0])).toBe(-8);
		expect(bm25Relatif(-8, -8)).toBe(1);
		expect(bm25Relatif(-2, -8)).toBe(0.25);
		// sans bm25, ou liste sans bm25 négatif : 1 ; bm25 nul dans une liste qui en a de négatifs : 0
		expect(bm25Relatif(undefined, -8)).toBe(1);
		expect(meilleurBm25([0, undefined])).toBeNull();
		expect(bm25Relatif(0, null)).toBe(1);
		expect(bm25Relatif(0, -8)).toBe(0);
	});

	it('une fiche prend le r de la première liste où elle paraît (tous les mots, puis l’un d’eux)', () => {
		const { relatifs, ordre } = bm25RelatifsDesListes([
			[{ chemin: 'a.md', bm25: -4 }],
			[
				{ chemin: 'b.md', bm25: -10 },
				{ chemin: 'a.md', bm25: -1 },
				{ chemin: 'c.md', bm25: -5 },
			],
		]);
		expect(ordre).toEqual(['a.md', 'b.md', 'c.md']);
		expect(relatifs.get('a.md')).toBe(1);
		expect(relatifs.get('b.md')).toBe(1);
		expect(relatifs.get('c.md')).toBe(0.5);
	});
});
