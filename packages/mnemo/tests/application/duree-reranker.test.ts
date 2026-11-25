import { describe, expect, it } from 'vitest';
import { DOCUMENTS_AU_HOOK, droiteDesDurees, dureeDuReranker, MARGE_MS, MARGE_RELATIVE, MESURES_GARDEES, rerankerMesure } from '../../src/application/duree-reranker.ts';
import type { Reranker } from '../../src/application/ports.ts';

const avecMarge = (ms: number) => ms * (1 + MARGE_RELATIVE) + MARGE_MS;

describe('droite des durées', () => {
	it('fixe et coût par document tirés des mesures (35 ms pour 5, 60 ms pour 10 : 10 ms plus 5 ms par document)', () => {
		const d = droiteDesDurees([
			{ documents: 5, ms: 35 },
			{ documents: 10, ms: 60 },
			{ documents: 5, ms: 35 },
			{ documents: 10, ms: 60 },
		]);
		expect(d).toEqual({ fixe: 10, parDocument: 5 });
	});

	it('une mesure aberrante (modèle qui démarre) ne déplace pas l’estimation', () => {
		const normales = [5, 10, 30, 5, 10, 30].map((documents) => ({ documents, ms: 10 + 5 * documents }));
		const d = droiteDesDurees([...normales, { documents: 30, ms: 4000 }]);
		expect(d!.parDocument).toBeCloseTo(5, 6);
		expect(d!.fixe).toBeCloseTo(10, 6);
	});

	it('une seule taille mesurée : durée proportionnelle au nombre de documents ; sans mesure : rien', () => {
		expect(droiteDesDurees([{ documents: 30, ms: 150 }])).toEqual({ fixe: 0, parDocument: 5 });
		expect(droiteDesDurees([])).toBeNull();
	});
});

describe('durée du reranker', () => {
	it('sans mesure : pas d’estimation, pas de reranker au hook', () => {
		const duree = dureeDuReranker();
		expect(duree.estimer(8)).toBeNull();
		expect(duree.documentsAuHook(10_000, 40)).toBeNull();
	});

	it('estimation marge comprise, d’après les dernières durées', () => {
		const duree = dureeDuReranker();
		duree.noter(5, 35);
		duree.noter(10, 60);
		expect(duree.estimer(8)).toBeCloseTo(avecMarge(50), 9);
	});

	it('k de 8 à 5 : le plus grand qui tient dans le temps restant, sinon aucun', () => {
		const duree = dureeDuReranker();
		duree.noter(5, 35);
		duree.noter(10, 60);
		expect(duree.documentsAuHook(avecMarge(50), 40)).toBe(8);
		expect(duree.documentsAuHook(avecMarge(45), 40)).toBe(7);
		expect(duree.documentsAuHook(avecMarge(35), 40)).toBe(5);
		expect(duree.documentsAuHook(avecMarge(35) - 1, 40)).toBeNull();
		expect(duree.documentsAuHook(0, 40)).toBeNull();
	});

	it('moins de candidates que le minimum : toutes, si elles tiennent ; aucune candidate : rien', () => {
		const duree = dureeDuReranker();
		duree.noter(5, 35);
		duree.noter(10, 60);
		expect(duree.documentsAuHook(10_000, 3)).toBe(3);
		expect(duree.documentsAuHook(10_000, 0)).toBeNull();
		expect(DOCUMENTS_AU_HOOK).toEqual({ min: 5, max: 8 });
	});

	it('seules les dernières mesures comptent : un reranker devenu lent ne tourne plus au hook', () => {
		const duree = dureeDuReranker();
		for (let i = 0; i < MESURES_GARDEES; i++) duree.noter(i % 2 === 0 ? 5 : 10, i % 2 === 0 ? 35 : 60);
		expect(duree.documentsAuHook(100, 40)).toBe(8);
		for (let i = 0; i < MESURES_GARDEES; i++) duree.noter(i % 2 === 0 ? 5 : 10, i % 2 === 0 ? 350 : 600);
		expect(duree.documentsAuHook(100, 40)).toBeNull();
	});

	it('une mesure invalide est ignorée', () => {
		const duree = dureeDuReranker();
		duree.noter(0, 30);
		duree.noter(5, Number.NaN);
		duree.noter(5, -1);
		expect(duree.estimer(5)).toBeNull();
	});
});

describe('reranker mesuré', () => {
	const faux = (notes: number[] | null | 'erreur'): Reranker => ({
		noter: async () => {
			if (notes === 'erreur') throw new Error('panne');
			return notes;
		},
	});
	const horloge = (pas: number) => {
		let t = 1000;
		return () => (t += pas);
	};
	const options = { budgetMs: 100, demarrer: false };

	it('un appel qui note chaque document est mesuré', async () => {
		const duree = dureeDuReranker();
		const r = rerankerMesure(faux([1, 2, 3, 4, 5]), duree, horloge(40));
		expect(await r.noter('q', ['a', 'b', 'c', 'd', 'e'], options)).toEqual([1, 2, 3, 4, 5]);
		expect(duree.estimer(5)).toBeCloseTo(avecMarge(40), 9);
	});

	it('sans réponse, réponse incomplète ou erreur : rien n’est mesuré (l’erreur passe)', async () => {
		const duree = dureeDuReranker();
		await rerankerMesure(faux(null), duree, horloge(40)).noter('q', ['a'], options);
		await rerankerMesure(faux([1]), duree, horloge(40)).noter('q', ['a', 'b'], options);
		await expect(rerankerMesure(faux('erreur'), duree, horloge(40)).noter('q', ['a'], options)).rejects.toThrow('panne');
		expect(duree.estimer(5)).toBeNull();
	});
});
