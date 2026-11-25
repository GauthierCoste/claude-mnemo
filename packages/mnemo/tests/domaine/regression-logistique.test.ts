import { describe, expect, it } from 'vitest';
import { apprendreRegression, perteMoyenne, probabilite, sigmoide } from '../../src/domaine/regression-logistique.ts';
import type { Exemple } from '../../src/domaine/regression-logistique.ts';

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function hasard(graine: number): () => number {
	let a = graine >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Exemples tirés d'un modèle connu : x uniformes dans [−2, 2] (la 2e variable dans une autre unité : [0, 0,4]). */
function tirer(n: number, biais: number, poids: number[], graine = 7): Exemple[] {
	const u = hasard(graine);
	return Array.from({ length: n }, () => {
		const x = poids.map((_, j) => (j === 1 ? u() * 0.4 : u() * 4 - 2));
		const z = biais + poids.reduce((s, w, j) => s + w * x[j]!, 0);
		return { x, y: u() < sigmoide(z) };
	});
}

describe('apprendreRegression', () => {
	it('retrouve des poids connus avec une pénalité faible, quelle que soit l’unité des variables', () => {
		const r = apprendreRegression(tirer(20_000, -1, [1.5, 5, 0.5]), { lambda: 1e-6 });
		expect(r.biais).toBeCloseTo(-1, 0);
		expect(r.poids[0]).toBeGreaterThan(1.35);
		expect(r.poids[0]).toBeLessThan(1.65);
		expect(r.poids[1]).toBeGreaterThan(4);
		expect(r.poids[1]).toBeLessThan(6);
		expect(r.poids[2]).toBeGreaterThan(0.4);
		expect(r.poids[2]).toBeLessThan(0.6);
	});

	it('respecte poids ≥ 0 : une variable de sens contraire reste à 0', () => {
		const exemples = tirer(5000, 0, [2, 0, -1.5]);
		const r = apprendreRegression(exemples, { lambda: 1e-4 });
		expect(r.poids[2]).toBe(0);
		expect(r.poids[0]).toBeGreaterThan(1.2); // tassé : la variable omise brouille les autres
		// sans la contrainte, le poids négatif est retrouvé
		const libre = apprendreRegression(exemples, { lambda: 1e-4, positifs: false });
		expect(libre.poids[2]).toBeLessThan(-1.2);
	});

	it('la L2 tasse les poids, d’autant plus qu’elle est forte', () => {
		const exemples = tirer(3000, 0.5, [1.5, 3, 1]);
		const norme = (lambda: number) => {
			const r = apprendreRegression(exemples, { lambda });
			return Math.hypot(r.poids[0]!, r.poids[1]! * 0.4 / 4, r.poids[2]!);
		};
		expect(norme(0.1)).toBeLessThan(norme(0.001));
		expect(norme(1)).toBeLessThan(norme(0.1));
		expect(norme(1)).toBeGreaterThan(0);
	});

	it('une variable constante garde un poids nul ; un seul jugement donne un biais fini', () => {
		const exemples: Exemple[] = [
			{ x: [1, 3], y: true },
			{ x: [2, 3], y: true },
			{ x: [-1, 3], y: false },
		];
		expect(apprendreRegression(exemples, { lambda: 0.01 }).poids[1]).toBe(0);
		const tous = apprendreRegression(exemples.map((e) => ({ ...e, y: true })), { lambda: 0.01 });
		expect(Number.isFinite(tous.biais)).toBe(true);
		expect(probabilite(tous, [0, 3])).toBeGreaterThan(0.5);
	});

	it('fait baisser la perte par rapport au modèle nul ; sans exemple, rien n’est appris', () => {
		const exemples = tirer(2000, 0, [2]);
		const r = apprendreRegression(exemples, { lambda: 0.01 });
		expect(perteMoyenne(r, exemples)).toBeLessThan(perteMoyenne({ biais: 0, poids: [0] }, exemples));
		expect(apprendreRegression([], { lambda: 0.1 })).toEqual({ biais: 0, poids: [] });
	});
});
