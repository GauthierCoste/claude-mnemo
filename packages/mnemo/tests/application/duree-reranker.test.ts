import { describe, expect, it } from 'vitest';
import { dureeDuReranker } from '../../src/application/duree-reranker.ts';
import type { OptionsModele, Reranker } from '../../src/application/ports.ts';
import { MARGE_MS, MARGE_RELATIVE, VALIDITE_MESURE_MS } from '../../src/domaine/droite-des-durees.ts';

const avecMarge = (ms: number) => ms * (1 + MARGE_RELATIVE) + MARGE_MS;
const injection: OptionsModele = { budgetMs: 100, demarrer: false, activite: { operation: 'injection' } };

/** Horloge réglable à la main. */
function horloge() {
	let t = 1_000_000;
	return { maintenant: () => t, avancer: (ms: number) => void (t += ms) };
}

/** Trois mesures de référence : 35 ms pour 5, 60 ms pour 10. */
function nourrie(maintenant: () => number = Date.now) {
	const duree = dureeDuReranker(maintenant);
	duree.noter({ documents: 5, ms: 35 });
	duree.noter({ documents: 10, ms: 60 });
	duree.noter({ documents: 5, ms: 35 });
	return duree;
}

describe('durée du reranker', () => {
	it('sans mesure, ou moins de 3 : pas d’estimation, pas de reranker au hook', () => {
		const duree = dureeDuReranker();
		expect(duree.fiable()).toBe(false);
		expect(duree.documentsAuHook(10_000, 40)).toBeNull();
		duree.noter({ documents: 5, ms: 35 });
		duree.noter({ documents: 10, ms: 60 });
		expect(duree.estimer(8)).toBeNull();
		duree.noter({ documents: 5, ms: 35 });
		expect(duree.fiable()).toBe(true);
		expect(duree.estimer(8)).toBeCloseTo(avecMarge(50), 9);
		expect(duree.documentsAuHook(avecMarge(50), 40)).toBe(8);
	});

	it('les mesures de plus de 30 min sont oubliées', () => {
		const h = horloge();
		const duree = nourrie(h.maintenant);
		h.avancer(VALIDITE_MESURE_MS + 1);
		expect(duree.fiable()).toBe(false);
		expect(duree.documentsAuHook(10_000, 40)).toBeNull();
	});

	it('un autre serveur du reranker (autre modèle, ou relancé) : on repart de zéro ; le même : rien ne change', () => {
		const duree = nourrie();
		duree.identifier('bge-reranker.gguf|101|2026-11-25T10:00:00Z');
		expect(duree.fiable()).toBe(true);
		duree.identifier('bge-reranker.gguf|101|2026-11-25T10:00:00Z');
		expect(duree.fiable()).toBe(true);
		duree.identifier('bge-reranker.gguf|202|2026-11-25T11:00:00Z');
		expect(duree.fiable()).toBe(false);
	});

	it('un appel du reranker en cours dans le service (même la palette) : pas de reranker au hook', async () => {
		const duree = nourrie();
		let finir: (notes: number[]) => void = () => {};
		const lent: Reranker = { noter: () => new Promise((r) => (finir = r)) };
		const appel = duree.envelopper(lent).noter('q', ['a'], { budgetMs: 1000, demarrer: false, activite: { operation: 'recherche' } });
		expect(duree.enCours()).toBe(1);
		expect(duree.documentsAuHook(10_000, 40)).toBeNull();
		finir([1]);
		await appel;
		expect(duree.enCours()).toBe(0);
		expect(duree.documentsAuHook(10_000, 40)).toBe(8);
	});
});

describe('reranker enveloppé', () => {
	const faux = (notes: number[] | null | 'erreur', h: ReturnType<typeof horloge>, ms: number): Reranker => ({
		noter: async () => {
			h.avancer(ms);
			if (notes === 'erreur') throw new Error('panne');
			return notes;
		},
	});

	it('seuls les appels « injection » qui notent chaque document sont mesurés ; la palette (recherche) ne l’est pas', async () => {
		const h = horloge();
		const duree = dureeDuReranker(h.maintenant);
		const r = duree.envelopper(faux([1, 2, 3, 4, 5], h, 35));
		await r.noter('q', ['a', 'b', 'c', 'd', 'e'], { ...injection, activite: { operation: 'recherche' } });
		await r.noter('q', ['a', 'b', 'c', 'd', 'e'], { budgetMs: 100, demarrer: false });
		expect(duree.fiable()).toBe(false);
		for (let i = 0; i < 3; i++) await r.noter('q', ['a', 'b', 'c', 'd', 'e'], injection);
		expect(duree.estimer(5)).toBeCloseTo(avecMarge(35), 9);
	});

	it('coupé par son échéance (rien après tout son budget) : mesure coupée, l’estimation n’est plus fiable ; sinon rien de noté', async () => {
		const h = horloge();
		const duree = nourrie(h.maintenant);
		// sans réponse tout de suite (modèle arrêté), réponse incomplète, erreur : rien
		await duree.envelopper(faux(null, h, 2)).noter('q', ['a'], injection);
		await duree.envelopper(faux([1], h, 40)).noter('q', ['a', 'b'], injection);
		await expect(duree.envelopper(faux('erreur', h, 40)).noter('q', ['a'], injection)).rejects.toThrow('panne');
		expect(duree.fiable()).toBe(true);
		await duree.envelopper(faux(null, h, 100)).noter('q', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], injection);
		expect(duree.fiable()).toBe(false);
		// une nouvelle mesure complète : fiable de nouveau, avec une marge doublée
		await duree.envelopper(faux([1, 2, 3, 4, 5, 6, 7, 8], h, 50)).noter('q', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], injection);
		expect(duree.fiable()).toBe(true);
		expect(duree.estimer(8)).toBeCloseTo(50 * (1 + MARGE_RELATIVE) * 2 + MARGE_MS, 9);
	});

	it('un appel chevauché par un autre (même de l’affinage) n’est pas mesuré, ni l’autre ; seul, il l’est', async () => {
		const h = horloge();
		const duree = dureeDuReranker(h.maintenant);
		const finirs: ((n: number[]) => void)[] = [];
		const lent: Reranker = { noter: (_q, textes) => new Promise((r) => finirs.push(() => (h.avancer(40), r(textes.map(() => 1))))) };
		const hook = duree.envelopper(lent);
		const fond = duree.envelopper(lent, { arrierePlan: true });
		for (let i = 0; i < 3; i++) {
			const a = hook.noter('q', ['a', 'b', 'c', 'd', 'e'], injection);
			const b = fond.noter('q', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], injection);
			for (const f of finirs.splice(0)) f([]);
			await Promise.all([a, b]);
		}
		expect(duree.fiable()).toBe(false);
		for (let i = 0; i < 3; i++) {
			const a = fond.noter('q', ['a', 'b', 'c', 'd', 'e'], injection);
			finirs.shift()!([]);
			await a;
		}
		expect(duree.fiable()).toBe(true);
	});

	it('affinage (arrière-plan) : ne retient pas le hook, et n’est jamais noté coupé', async () => {
		const h = horloge();
		const duree = nourrie(h.maintenant);
		let finir: (n: number[] | null) => void = () => {};
		const appel = duree.envelopper({ noter: () => new Promise((r) => (finir = r)) }, { arrierePlan: true }).noter('q', ['a'], injection);
		expect(duree.enCours()).toBe(0);
		expect(duree.documentsAuHook(10_000, 40)).toBe(8);
		h.avancer(200);
		finir(null);
		await appel;
		expect(duree.fiable()).toBe(true);
	});

	it('jamais une enveloppe d’enveloppe', () => {
		const duree = dureeDuReranker();
		const r: Reranker = { noter: async () => null };
		const une = duree.envelopper(r);
		expect(duree.envelopper(une)).toBe(une);
	});
});
