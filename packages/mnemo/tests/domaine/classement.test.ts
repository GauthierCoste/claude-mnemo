import { describe, expect, it } from 'vitest';
import { classer, fusionner, POIDS_COMPLEMENTAIRE } from '../../src/domaine/classement.ts';
import type { ElementIndexe } from '../../src/domaine/elements.ts';
import { noterRecherche, POIDS_RECHERCHE_PAR_DEFAUT } from '../../src/domaine/note-de-recherche.ts';

function el(id: string, surcharge: Partial<ElementIndexe> = {}): ElementIndexe {
	return {
		id, chemin: `${id}.md`, genre: 'fait', typeFiche: 'sujet', texte: id, contexte: id, statut: 'servi',
		date: '2026-11-22', valideFin: null, finIncluse: false, confiance: null, source: null, typeSource: null, categorie: null,
		niveau: null, portee: null, dossierProjet: null, ...surcharge,
	};
}
const CTX = {};

describe('fusionner', () => {
	it('place en tête l’élément bien classé dans les deux listes', () => {
		const [a, b, c] = [el('a'), el('b'), el('c')];
		const r = fusionner([[a, b], [b, c]]);
		expect(r.map((x) => x.element.id)).toEqual(['b', 'a', 'c']);
		expect(r[0]!.rangs).toEqual([2, 1]);
	});
});

describe('classer', () => {
	it('normalise : premier de toutes les listes = 1', () => {
		const r = classer(fusionner([[el('a')], [el('a')]]), CTX);
		expect(r[0]!.pertinence).toBeCloseTo(1);
		expect(r[0]!.base).toBeCloseTo(1);
	});
	it('normalise par les listes non vides : premier de la seule liste qui a répondu = 1', () => {
		const r = classer([{ element: el('a'), rangs: [0, 1] }], CTX);
		expect(r[0]!.pertinence).toBeCloseTo(1);
	});
	it('listes complémentaires : apport gradué, Pm + (1 − Pm) × λ × Pc ; un élément des mots seuls garde sa pertinence', () => {
		const C = { ...CTX, listesComplementaires: [1] };
		const seul = classer([{ element: el('a'), rangs: [1] }, { element: el('b'), rangs: [2] }], CTX);
		const avec = classer([{ element: el('a'), rangs: [1, 0] }, { element: el('b'), rangs: [2, 0] }, { element: el('g'), rangs: [0, 1] }], C);
		const pertinence = (r: ReturnType<typeof classer>, id: string) => r.find((x) => x.element.id === id)!.pertinence;
		expect(pertinence(avec, 'a')).toBe(pertinence(seul, 'a'));
		expect(pertinence(avec, 'b')).toBe(pertinence(seul, 'b'));
		// complémentaire seule, rang 1 : λ × 1
		expect(pertinence(avec, 'g')).toBeCloseTo(POIDS_COMPLEMENTAIRE, 12);
		// mots rang 2 (Pm = 61/62) + sens rang 3 (Pc = 61/63)
		const pm = 61 / 62;
		const [m] = classer([{ element: el('m'), rangs: [2, 3] }], C);
		expect(m!.pertinence).toBeCloseTo(pm + (1 - pm) * POIDS_COMPLEMENTAIRE * (61 / 63), 12);
		// Pc = maximum sur les complémentaires : une autre liste qui a répondu (graphe) ne divise pas un élément du seul sens
		const deux = classer([{ element: el('x'), rangs: [0, 1, 0] }, { element: el('y'), rangs: [0, 0, 1] }], { ...CTX, listesComplementaires: [1, 2] });
		expect(pertinence(deux, 'x')).toBeCloseTo(POIDS_COMPLEMENTAIRE, 12);
		expect(pertinence(deux, 'y')).toBeCloseTo(POIDS_COMPLEMENTAIRE, 12);
		const vide = classer([{ element: el('x'), rangs: [0, 1, 0] }], { ...CTX, listesComplementaires: [1, 2] });
		expect(vide[0]!.pertinence).toBeCloseTo(POIDS_COMPLEMENTAIRE, 12);
		// dans les deux listes : la meilleure compte, pas de cumul
		const les2 = classer([{ element: el('z'), rangs: [0, 3, 1] }], { ...CTX, listesComplementaires: [1, 2] });
		expect(les2[0]!.pertinence).toBeCloseTo(POIDS_COMPLEMENTAIRE, 12);
		const [z] = classer([{ element: el('z'), rangs: [0, 3, 2] }], { ...CTX, listesComplementaires: [1, 2] });
		expect(z!.pertinence).toBeCloseTo(POIDS_COMPLEMENTAIRE * (61 / 62), 12);
		// un élément du seul sens ne dépasse jamais λ, graphe vide ou non (base comprise : sans bm25, r = 1)
		for (const rangs of [[0, 1, 0], [0, 1, 5], [0, 2, 1]]) {
			for (const r of classer([{ element: el('s'), rangs }, { element: el('g'), rangs: [0, 0, 1] }], { ...CTX, listesComplementaires: [1, 2] })) {
				expect(r.pertinence).toBeLessThanOrEqual(POIDS_COMPLEMENTAIRE + 1e-12);
				expect(r.base).toBe(r.pertinence);
			}
		}
	});
	it('listes complémentaires : à rangs complémentaires égaux, l\'ordre des mots est gardé (pas de saturation)', () => {
		const r = classer(
			[1, 2, 3, 4].map((rang) => ({ element: el(`m${rang}`), rangs: [rang, 1] })),
			{ ...CTX, listesComplementaires: [1] },
		);
		expect(r.map((x) => x.element.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
		for (let i = 1; i < r.length; i++) expect(r[i]!.base).toBeLessThan(r[i - 1]!.base);
		expect(r[0]!.pertinence).toBe(1);
	});
	it('ni confiance, ni voisinage, ni fraîcheur : à rangs égaux, même pertinence et même base', () => {
		const r = classer([
			{ element: el('a', { confiance: 0.3, date: '2020-01-01' }), rangs: [1] },
			{ element: el('b', { confiance: 1, date: '2026-11-22' }), rangs: [1] },
		], CTX);
		expect(r[0]!.base).toBe(r[1]!.base);
		expect(r[0]!.pertinence).toBe(r[1]!.pertinence);
	});
	it('égalité départagée par date récente puis id', () => {
		const t = classer([
			{ element: el('b', { date: '2026-11-22' }), rangs: [1] },
			{ element: el('a', { date: '2026-11-22' }), rangs: [1] },
		], CTX);
		expect(t.map((x) => x.element.id)).toEqual(['a', 'b']);
		const d = classer([
			{ element: el('a', { date: '2026-01-01' }), rangs: [1] },
			{ element: el('b', { date: '2026-11-22' }), rangs: [1] },
		], CTX);
		expect(d.map((x) => x.element.id)).toEqual(['b', 'a']);
	});
	it('ne produit jamais NaN (aucune liste, date malformée)', () => {
		expect(classer([], CTX)).toEqual([]);
		const r = classer([{ element: el('a', { date: 'hier' }), rangs: [1] }], CTX);
		expect(Number.isNaN(r[0]!.base)).toBe(false);
		expect(r[0]!.base).toBeCloseTo(1);
	});
});

describe('classer : base modulée par le bm25', () => {
	it('base = Pm × (0,5 + 0,5 × r), r = bm25 rapporté au meilleur de la liste ; la pertinence ne change pas', () => {
		const r = classer([{ element: el('a', { bm25: -10 }), rangs: [1] }, { element: el('b', { bm25: -5 }), rangs: [2] }], CTX);
		const b = r.find((x) => x.element.id === 'b')!;
		expect(r[0]!.base).toBeCloseTo(1, 12);
		expect(b.pertinence).toBeCloseTo(61 / 62, 12);
		expect(b.base).toBeCloseTo((61 / 62) * 0.75, 12);
	});
	it('un fait qui ne doit son rang qu’au contexte de sa fiche passe loin sous celui qui porte les mots (cas A réduit)', () => {
		// une seule liste de mots : le bon fait (bm25 −12) devant deux faits qui n'ont que les mots du contexte (−3)
		const r = classer([
			{ element: el('bon', { bm25: -12 }), rangs: [1] },
			{ element: el('l1', { bm25: -3 }), rangs: [2] },
			{ element: el('l2', { bm25: -3 }), rangs: [3] },
		], CTX);
		expect(r.map((x) => x.element.id)).toEqual(['bon', 'l1', 'l2']);
		// leurre : 61/62 × (0,5 + 0,5 × 0,25) ≈ 0,615 ; l'écart (≈ 0,385) dépasse tous les poids réunis
		expect(r[1]!.base).toBeCloseTo((61 / 62) * 0.625, 12);
	});
	it('le meilleur bm25 est pris dans la liste de mots où l’élément figure en premier (« toutes », sinon « une »)', () => {
		const r = classer([
			{ element: el('x', { bm25: -20 }), rangs: [1, 0] },
			{ element: el('y', { bm25: -4 }), rangs: [0, 1] },
			{ element: el('z', { bm25: -2 }), rangs: [0, 2] },
		], CTX);
		const base = (id: string) => r.find((c) => c.element.id === id)!.base;
		expect(base('x')).toBeCloseTo(0.5, 12);
		// y est le meilleur de « une » : r = 1, malgré le bm25 de x dans « toutes »
		expect(base('y')).toBeCloseTo(0.5, 12);
		expect(base('z')).toBeCloseTo((61 / 124) * 0.75, 12);
	});
	it('la part du sens et du graphe n’est pas modulée par le bm25', () => {
		const r = classer([
			{ element: el('a', { bm25: -10 }), rangs: [1, 0] },
			{ element: el('m', { bm25: -5 }), rangs: [2, 1] },
		], { listesComplementaires: [1] });
		const pm = 61 / 62;
		const m = r.find((c) => c.element.id === 'm')!;
		expect(m.pertinence).toBeCloseTo(pm + (1 - pm) * POIDS_COMPLEMENTAIRE, 12);
		expect(m.base).toBeCloseTo(pm * 0.75 + (1 - pm) * POIDS_COMPLEMENTAIRE, 12);
	});
	it('sans bm25 : r = 1 ; bm25 nul dans une liste qui en a de négatifs : r = 0', () => {
		const r = classer([{ element: el('a', { bm25: -10 }), rangs: [1] }, { element: el('b'), rangs: [2] }, { element: el('c', { bm25: 0 }), rangs: [3] }], CTX);
		const de = (id: string) => r.find((x) => x.element.id === id)!;
		expect(de('a').base).toBe(de('a').pertinence);
		expect(de('b').base).toBe(de('b').pertinence);
		expect(de('c').base).toBeCloseTo((61 / 63) * 0.5, 12);
		// aucun bm25 négatif dans la liste : r = 1
		for (const c of classer([{ element: el('x', { bm25: 0 }), rangs: [1] }, { element: el('y', { bm25: 0 }), rangs: [2] }], CTX)) expect(c.base).toBe(c.pertinence);
	});
});

describe('classer avec pertinences', () => {
	/** Pertinences triées (décroissantes) d'un classement. */
	const pertinences = (r: { pertinence: number }[]) => r.map((x) => x.pertinence).sort((a, b) => b - a);

	it('le reranker fixe l’ordre ; les pertinences d’avant sont redistribuées (même ensemble de valeurs)', () => {
		const cands = fusionner([[el('a'), el('b'), el('c')], [el('a'), el('c')]]);
		const avant = classer(cands, CTX);
		const r = classer(cands, { ...CTX, pertinences: new Map([['a', 0.1], ['b', 0.9], ['c', 0.5]]) });
		expect(r.map((x) => x.element.id)).toEqual(['b', 'c', 'a']);
		// même multiensemble de pertinences : le seuil garde son échelle
		expect(pertinences(r)).toEqual(pertinences(avant));
		expect(r[0]!.pertinence).toBe(avant[0]!.pertinence);
		expect(r.map((x) => x.rangReranker)).toEqual([0, 1, 2]);
	});
	it('une paraphrase mise en tête par le reranker reçoit la plus haute pertinence, quelle que soit l’échelle de sa note', () => {
		const cands = fusionner([[el('a'), el('b')]]);
		const avant = classer(cands, CTX);
		// notes minuscules (sigmoïde de logits très négatifs) : seule leur comparaison compte
		const r = classer(cands, { ...CTX, pertinences: new Map([['a', 0.001], ['b', 0.016]]) });
		expect(r.map((x) => x.element.id)).toEqual(['b', 'a']);
		expect(r.map((x) => x.pertinence)).toEqual(avant.map((x) => x.pertinence));
	});
	it('un élément noté : base = sa pertinence redistribuée, quel que soit son bm25', () => {
		const cands = [{ element: el('a', { bm25: -10 }), rangs: [1] }, { element: el('b', { bm25: -1 }), rangs: [2] }];
		const r = classer(cands, { ...CTX, pertinences: new Map([['a', 0.2], ['b', 0.9]]) });
		expect(r.map((x) => x.element.id)).toEqual(['b', 'a']);
		expect(r[0]!.base).toBe(1);
		expect(r[1]!.base).toBeCloseTo(61 / 62, 12);
		for (const c of r) expect(c.base).toBe(c.pertinence);
	});
	it('place les non notés sous le plus bas des notés (base plafonnée, pertinence intacte)', () => {
		const cands = fusionner([[el('x'), el('a'), el('b')]]);
		const r = classer(cands, { ...CTX, pertinences: new Map([['a', 0.2], ['b', 0.1]]) });
		expect(r.map((e) => e.element.id)).toEqual(['a', 'b', 'x']);
		expect(r[2]!.base).toBeLessThanOrEqual(r[1]!.base * 0.99 + 1e-12);
		expect(r[2]!.pertinence).toBe(1);
		expect(r[2]!.rangReranker).toBe(Infinity);
	});
	it('le plafond porte sur la base seule : un poids peut faire passer un non noté devant un noté (voulu)', () => {
		const cands = fusionner([[el('x'), el('a')]]);
		const r = classer(cands, { ...CTX, pertinences: new Map([['a', 0.2]]) });
		expect(r.map((e) => e.element.id)).toEqual(['a', 'x']);
		const faits = (dansVoisinage: boolean) => ({ dansVoisinage, confiance: 1, deLaMemoire: true, date: null, aujourdhui: '2026-11-24' });
		const note = (id: string, voisin: boolean) => noterRecherche(r.find((e) => e.element.id === id)!.base, faits(voisin), POIDS_RECHERCHE_PAR_DEFAUT).total;
		// x (non noté, base 0,99 × celle de a) est dans le projet courant : + 0,1, il passe devant a
		expect(note('x', true)).toBeGreaterThan(note('a', false));
	});
	it('est identique à l’absence de pertinences quand la table est vide', () => {
		const cands = fusionner([[el('a'), el('b')]]);
		expect(classer(cands, { ...CTX, pertinences: new Map() })).toEqual(classer(cands, CTX));
	});
	it('bases égales entre notés : l’ordre du reranker avant la date et l’id', () => {
		// a et b premiers chacun d'une liste de mots : même pertinence (0,5), même date ; sans reranker, l'id départage (a, b)
		const cands = [{ element: el('a'), rangs: [1, 0] }, { element: el('b'), rangs: [0, 1] }];
		expect(classer(cands, CTX).map((e) => e.element.id)).toEqual(['a', 'b']);
		const r = classer(cands, { ...CTX, pertinences: new Map([['a', 0.1], ['b', 0.9]]) });
		expect(r[0]!.base).toBe(r[1]!.base);
		expect(r.map((e) => e.element.id)).toEqual(['b', 'a']);
	});
	it('note non finie : classée la dernière des notées ; à notes égales, l’ordre d’avant', () => {
		const cands = fusionner([[el('x'), el('a'), el('b'), el('c')]]);
		const r = classer(cands, { ...CTX, pertinences: new Map([['a', NaN], ['b', 0.5], ['c', 0.5]]) });
		expect(r.every((e) => Number.isFinite(e.base))).toBe(true);
		expect(r.map((e) => e.element.id)).toEqual(['b', 'c', 'a', 'x']);
	});
});
