import type { ClassementVue, EntreeServieVue } from '@mnemo/contrat';
import { describe, expect, it } from 'vitest';
import { dernierClassement, estEcarte, pourcentage, sousLeSeuil } from '../../src/sessions/classement.ts';

const c = (id: string, rang: number, note: number | null, servi = false): ClassementVue => ({ id, titre: id, note, servi, rang });
const entree = (horodatageMs: number, classement: ClassementVue[]): EntreeServieVue => ({ session: 's1', moment: 'message', horodatageMs, ids: [], texte: '', ms: 1, sens: false, classement, muet: null, cartes: [] });
const ids = (l: ClassementVue[]) => l.map((x) => x.id);

describe('classement', () => {
	it('dernierClassement : celui de l’entrée la plus récente ; sans notes, trié par rang', () => {
		const entrees = [entree(1, [c('vieux.md', 1, null)]), entree(5, [c('b.md', 2, null), c('a.md', 1, null)]), entree(3, [c('moyen.md', 1, null)])];
		expect(ids(dernierClassement(entrees, []))).toEqual(['a.md', 'b.md']);
		expect(dernierClassement([], [])).toEqual([]);
	});

	it('avec des notes : triées par note décroissante (le pourcentage est l’ordre), les lignes sans note après, par rang', () => {
		const entrees = [entree(1, [c('a.md', 1, 0.4), c('b.md', 2, null, true), c('c.md', 3, 0.9), c('d.md', 4, 0.6), c('e.md', 5, null)])];
		expect(ids(dernierClassement(entrees, []))).toEqual(['c.md', 'd.md', 'a.md', 'b.md', 'e.md']);
	});

	it('seuil : une fiche notée sous le seuil est masquée, sauf si elle a été servie ; écartés retirés (une fiche emporte ses éléments)', () => {
		const entrees = [entree(1, [c('a.md', 1, 0.9), c('b.md', 2, 0.04), c('c.md', 3, 0.05), c('d.md', 4, 0.01, true), c('e.md', 5, null)])];
		expect(ids(dernierClassement(entrees, []))).toEqual(['a.md', 'c.md', 'd.md', 'e.md']);
		expect(ids(dernierClassement(entrees, ['a.md', 'c.md#^f-1', 'e.md']))).toEqual(['c.md', 'd.md']);
	});

	it('sousLeSeuil : les fiches masquées par le seuil, comptées à part (ni servies, ni écartées)', () => {
		const entrees = [entree(1, [c('a.md', 1, 0.9), c('b.md', 2, 0.04), c('f.md', 6, 0.02), c('d.md', 4, 0.01, true)])];
		expect(ids(sousLeSeuil(entrees, []))).toEqual(['b.md', 'f.md']);
		expect(ids(sousLeSeuil(entrees, ['f.md']))).toEqual(['b.md']);
		expect(sousLeSeuil([], [])).toEqual([]);
	});

	it('estEcarte : l’id même, ou sa fiche', () => {
		expect(estEcarte('a.md#^f-1', ['a.md'])).toBe(true);
		expect(estEcarte('a.md', ['a.md#^f-1'])).toBe(false);
		expect(estEcarte('ab.md', ['a.md'])).toBe(false);
	});

	it('pourcentage : entier, avec espace insécable ; rien sans note', () => {
		expect(pourcentage(0.874)).toBe('87 %');
		expect(pourcentage(1)).toBe('100 %');
		expect(pourcentage(null)).toBeNull();
	});
});
