import { describe, expect, it } from 'vitest';
import type { Reranker } from '../../src/application/ports.ts';
import { rerankerParMorceaux } from '../../src/application/reranker-par-morceaux.ts';

const OPTIONS = { budgetMs: 1000, demarrer: false };

describe('reranker par morceaux', () => {
	it('découpe les textes en morceaux soumis l’un après l’autre, les notes dans l’ordre', async () => {
		const appels: string[][] = [];
		let enCours = 0;
		let auPlus = 0;
		const reranker: Reranker = {
			async noter(_requete, textes) {
				appels.push(textes);
				enCours++;
				auPlus = Math.max(auPlus, enCours);
				await new Promise((r) => setTimeout(r, 1));
				enCours--;
				return textes.map((t) => Number(t));
			},
		};
		const textes = Array.from({ length: 23 }, (_, i) => String(i));
		expect(await rerankerParMorceaux(reranker, 10).noter('q', textes, OPTIONS)).toEqual(textes.map(Number));
		expect(appels.map((a) => a.length)).toEqual([10, 10, 3]);
		expect(auPlus).toBe(1);
	});

	it('peu de textes : un seul appel ; un morceau sans réponse (ou incomplet) : null, les suivants ne sont pas soumis', async () => {
		let appels = 0;
		const muet: Reranker = {
			async noter(_r, textes) {
				appels++;
				return appels === 1 ? textes.map(() => 0) : textes.slice(1).map(() => 0);
			},
		};
		expect(await rerankerParMorceaux(muet, 10).noter('q', ['a', 'b'], OPTIONS)).toEqual([0, 0]);
		appels = 0;
		expect(await rerankerParMorceaux(muet, 2).noter('q', ['a', 'b', 'c', 'd', 'e', 'f'], OPTIONS)).toBeNull();
		expect(appels).toBe(2);
	});
});
