import type { ClassementVue, EntreeServieVue } from '@mnemo/contrat';
import { describe, expect, it } from 'vitest';
import { dernierClassement, estCalibre, estEcarte, modesDInjection, pourcentage, seuilInjection, sousLeSeuil } from '../../src/sessions/classement.ts';

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

	it('estCalibre : seulement une entrée qui le dit ; une entrée ancienne ou en ordre seul, non', () => {
		expect(estCalibre({ ...entree(1, []), calibree: true })).toBe(true);
		expect(estCalibre({ ...entree(1, []), calibree: false })).toBe(false);
		expect(estCalibre(entree(1, []))).toBe(false);
		expect(estCalibre(null)).toBe(false);
	});

	it('seuilInjection : le réglage en fraction, 90 % sans réglages', () => {
		expect(seuilInjection(undefined)).toBe(0.9);
		const champ = { cle: 'contexte.seuilInjection', groupe: 'contexte', libelle: '', explication: '', genre: 'entier', defaut: 90, valeur: 85, unite: '%', effet: 'immediat' };
		expect(seuilInjection({ champs: [champ] as never, avertissements: [], enAttente: [] })).toBe(0.85);
	});

	it('modesDInjection : journal des gestes plus lignes `auto` reçues ; au même message, la note du journal ; la plus récente injection l’emporte', () => {
		const auto = (id: string, p: number): ClassementVue => ({ ...c(id, 1, p, true), p, auto: true });
		const entrees = [entree(10, [auto('a.md', 0.97)]), entree(20, [auto('b.md', 0.92)])];
		const modes = modesDInjection(
			[
				{ chemin: 'a.md', mode: 'auto', horodatageMs: 10, p: 0.94 },
				{ chemin: 'c.md', mode: 'main', horodatageMs: 5 },
				{ chemin: 'b.md', mode: 'main', horodatageMs: 15 },
			],
			entrees,
		);
		expect(modes.get('a.md')).toEqual({ mode: 'auto', horodatageMs: 10, p: 0.94 });
		expect(modes.get('b.md')).toEqual({ mode: 'auto', horodatageMs: 20, p: 0.92 });
		expect(modes.get('c.md')).toEqual({ mode: 'main', horodatageMs: 5 });
		expect(modes.has('d.md')).toBe(false);
	});
});
