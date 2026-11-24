import { describe, expect, it } from 'vitest';
import { BUDGET_PAR_ENTREE, etendre, libelleEtendue } from '../../src/domaine/etendue.ts';

const morceau = (n: number, taille = 100) => ({ id: `d.md#p-${n}`, texte: `P${n} ${'x'.repeat(taille - 3 - String(n).length)}.` });
const section = (n: number, taille = 100) => Array.from({ length: n }, (_, i) => morceau(i, taille));

describe('étendue servie d\'un passage (petit pour chercher, grand pour lire)', () => {
	it('le budget par entrée vaut 6 000 caractères', () => {
		expect(BUDGET_PAR_ENTREE).toBe(6000);
	});

	it('voisins : le passage trouvé avec le précédent et le suivant de sa section, dans l\'ordre', () => {
		const s = section(5);
		const e = etendre(s, ['d.md#p-2'], 'voisins');
		expect(e).toMatchObject({ mode: 'voisins', ids: ['d.md#p-1', 'd.md#p-2', 'd.md#p-3'], tronque: false });
		expect(e.texte).toBe([s[1]!.texte, s[2]!.texte, s[3]!.texte].join('\n\n'));
		// en bord de section : un seul voisin ; seul dans sa section : le passage seul
		expect(etendre(s, ['d.md#p-0'], 'voisins').ids).toEqual(['d.md#p-0', 'd.md#p-1']);
		expect(etendre([s[0]!], ['d.md#p-0'], 'voisins')).toMatchObject({ mode: 'passage', ids: ['d.md#p-0'], texte: s[0]!.texte });
	});

	it('section : toute la section, quand elle tient dans le budget', () => {
		const s = section(5);
		const e = etendre(s, ['d.md#p-1', 'd.md#p-3'], 'section');
		expect(e).toMatchObject({ mode: 'section', ids: s.map((m) => m.id), tronque: false });
		expect(e.texte).toBe(s.map((m) => m.texte).join('\n\n'));
	});

	it('budget dépassé : les passages trouvés restent entiers, les voisins sont coupés de façon visible (« … »)', () => {
		const s = section(3, 2000);
		const e = etendre(s, ['d.md#p-1'], 'voisins', 3000);
		expect(e.tronque).toBe(true);
		expect(e.texte.length).toBeLessThanOrEqual(3000);
		expect(e.texte).toContain(s[1]!.texte);
		// le précédent garde sa fin, le suivant son début
		const [avant, , apres] = e.texte.split('\n\n');
		expect(avant!.startsWith('…')).toBe(true);
		expect(apres!.endsWith('…')).toBe(true);
	});

	it('section trop longue : les trouvés entiers, les plus proches ensuite, le reste marqué « … »', () => {
		const s = section(10, 1500);
		const e = etendre(s, ['d.md#p-4', 'd.md#p-5'], 'section');
		expect(e.mode).toBe('section');
		expect(e.tronque).toBe(true);
		expect(e.texte.length).toBeLessThanOrEqual(BUDGET_PAR_ENTREE);
		expect(e.texte).toContain(s[4]!.texte);
		expect(e.texte).toContain(s[5]!.texte);
		expect(e.texte.startsWith('…')).toBe(true);
		expect(e.texte.endsWith('…')).toBe(true);
		expect(e.ids).toContain('d.md#p-3');
		expect(e.ids).not.toContain('d.md#p-0');
	});

	it('un passage trouvé plus grand que le budget est gardé entier, sans voisin', () => {
		const s = section(3, 7000);
		const e = etendre(s, ['d.md#p-1'], 'voisins');
		expect(e.ids).toEqual(['d.md#p-1']);
		expect(e.texte).toBe(s[1]!.texte);
	});

	it('section dont les trouvés ne tiennent pas ensemble : le meilleur entier, l\'autre coupé, et `complets` le dit', () => {
		const s = section(3, 1400);
		const e = etendre(s, ['d.md#p-2', 'd.md#p-0'], 'section', 2000);
		expect(e.texte.length).toBeLessThanOrEqual(2000);
		expect(e.texte).toContain(s[2]!.texte);
		expect(e.texte).not.toContain(s[0]!.texte);
		expect(e.complets).toEqual(['d.md#p-2']);
		expect(e.tronque).toBe(true);
		// tout tient : tous complets
		expect(etendre(s, ['d.md#p-2', 'd.md#p-0'], 'section').complets).toEqual(s.map((m) => m.id));
	});

	it('exclus (déjà servis) : jamais repris en voisin, « … » à leur place', () => {
		const s = section(5);
		const e = etendre(s, ['d.md#p-2'], 'voisins', 6000, new Set(['d.md#p-1']));
		expect(e.ids).toEqual(['d.md#p-2', 'd.md#p-3']);
		expect(e.texte).not.toContain(s[1]!.texte);
		const tout = etendre(s, ['d.md#p-0', 'd.md#p-4'], 'section', 6000, new Set(['d.md#p-2']));
		expect(tout.ids).toEqual(['d.md#p-0', 'd.md#p-1', 'd.md#p-3', 'd.md#p-4']);
		expect(tout.texte).toBe([s[0]!.texte, s[1]!.texte, '…', s[3]!.texte, s[4]!.texte].join('\n\n'));
	});

	it('libellé de l\'étendue servie', () => {
		expect(libelleEtendue({ mode: 'section', ids: ['a', 'b', 'c'], tronque: false })).toBe('section entière, 3 passages');
		expect(libelleEtendue({ mode: 'section', ids: ['a', 'b'], tronque: true })).toBe('section, 2 passages, coupée');
		expect(libelleEtendue({ mode: 'voisins', ids: ['a', 'b', 'c'], tronque: false })).toBe('passage et ses voisins, 3 passages');
		expect(libelleEtendue({ mode: 'voisins', ids: ['a', 'b'], tronque: true })).toBe('passage et ses voisins, 2 passages, coupée');
		expect(libelleEtendue({ mode: 'passage', ids: ['a'], tronque: false })).toBe('passage seul');
	});
});
