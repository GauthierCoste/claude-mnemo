import { describe, expect, it } from 'vitest';
import {
	documentsQuiTiennent,
	droiteDesDurees,
	dureeEstimee,
	estimationFiable,
	facteurDeMarge,
	MARGE_MS,
	MARGE_RELATIVE,
	MESURES_GARDEES,
	mesuresValables,
	VALIDITE_MESURE_MS,
} from '../../src/domaine/droite-des-durees.ts';
import type { MesureDuReranker } from '../../src/domaine/droite-des-durees.ts';

const avecMarge = (ms: number, facteur = 1) => ms * (1 + MARGE_RELATIVE) * facteur + MARGE_MS;
/** Mesures de la machine de référence (documents courts) : 35 ms pour 5, 60 ms pour 10, à partir de `t`. */
const reference = (t = 0): MesureDuReranker[] => [
	{ documents: 5, ms: 35, instantMs: t },
	{ documents: 10, ms: 60, instantMs: t + 1 },
	{ documents: 5, ms: 35, instantMs: t + 2 },
];

describe('droite des durées', () => {
	it('fixe et coût par document (35 ms pour 5, 60 ms pour 10 : 10 ms plus 5 ms par document)', () => {
		expect(droiteDesDurees(reference())).toEqual({ fixe: 10, parDocument: 5 });
	});

	it('une mesure aberrante (modèle qui démarre) ne déplace pas l’estimation', () => {
		const normales = [5, 10, 30, 5, 10, 30].map((documents) => ({ documents, ms: 10 + 5 * documents }));
		const d = droiteDesDurees([...normales, { documents: 30, ms: 4000 }]);
		expect(d!.parDocument).toBeCloseTo(5, 6);
		expect(d!.fixe).toBeCloseTo(10, 6);
	});

	it('une seule taille : proportionnelle ; sans mesure complète : rien (une mesure coupée n’en est pas une)', () => {
		expect(droiteDesDurees([{ documents: 30, ms: 150 }])).toEqual({ fixe: 0, parDocument: 5 });
		expect(droiteDesDurees([])).toBeNull();
		expect(droiteDesDurees([{ documents: 8, ms: 40, censuree: true }])).toBeNull();
	});
});

describe('estimation', () => {
	it('fiable à partir de 3 mesures complètes ; moins : pas d’estimation, pas de reranker au hook', () => {
		const trois = reference();
		expect(estimationFiable(trois.slice(0, 2))).toBe(false);
		expect(dureeEstimee(trois.slice(0, 2), 8)).toBeNull();
		expect(documentsQuiTiennent(trois.slice(0, 2), 10_000, 40)).toBeNull();
		expect(estimationFiable(trois)).toBe(true);
		expect(dureeEstimee(trois, 8)).toBeCloseTo(avecMarge(50), 9);
	});

	it('k de 8 à 5 : le plus grand qui tient, sinon aucun ; moins de candidates : toutes', () => {
		const m = reference();
		expect(documentsQuiTiennent(m, avecMarge(50), 40)).toBe(8);
		expect(documentsQuiTiennent(m, avecMarge(45), 40)).toBe(7);
		expect(documentsQuiTiennent(m, avecMarge(35), 40)).toBe(5);
		expect(documentsQuiTiennent(m, avecMarge(35) - 1, 40)).toBeNull();
		expect(documentsQuiTiennent(m, 10_000, 3)).toBe(3);
		expect(documentsQuiTiennent(m, 10_000, 0)).toBeNull();
	});

	it('mesures valables : 30 min au plus, les plus récentes, dans l’ordre', () => {
		const vieille = { documents: 5, ms: 35, instantMs: 0 };
		const recente = { documents: 5, ms: 35, instantMs: VALIDITE_MESURE_MS + 10 };
		expect(mesuresValables([recente, vieille], VALIDITE_MESURE_MS + 20)).toEqual([recente]);
		const beaucoup = Array.from({ length: MESURES_GARDEES + 5 }, (_, i) => ({ documents: 5, ms: 35, instantMs: i }));
		expect(mesuresValables(beaucoup, 100)).toHaveLength(MESURES_GARDEES);
		expect(mesuresValables(beaucoup, 100)[0]!.instantMs).toBe(5);
	});

	it('un appel coupé : l’estimation n’est plus fiable jusqu’à une mesure complète ; ensuite, sa marge double', () => {
		const coupe: MesureDuReranker = { documents: 8, ms: 40, instantMs: 10, censuree: true };
		const apresCoupe = [...reference(), coupe];
		expect(estimationFiable(apresCoupe)).toBe(false);
		expect(dureeEstimee(apresCoupe, 8)).toBeNull();
		const remesuree = [...apresCoupe, { documents: 8, ms: 50, instantMs: 11 }];
		expect(estimationFiable(remesuree)).toBe(true);
		expect(facteurDeMarge(remesuree)).toBe(2);
		// deux appels coupés parmi les 5 dernières mesures : ×4 ; sortis de la fenêtre, la marge redevient simple
		expect(facteurDeMarge([...remesuree, { ...coupe, instantMs: 12 }, { documents: 8, ms: 50, instantMs: 13 }])).toBe(4);
		const plusTard = [...remesuree, ...Array.from({ length: 5 }, (_, i) => ({ documents: 8, ms: 50, instantMs: 20 + i }))];
		expect(facteurDeMarge(plusTard)).toBe(1);
	});
});
