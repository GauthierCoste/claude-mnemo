import type { EntreeServieVue } from '@mnemo/contrat';
import { describe, expect, it } from 'vitest';
import { fichesProposees, titresConnus } from '../../src/sessions/servis.ts';

const entree = (horodatageMs: number, cartes: string[], titres?: Record<string, string>): EntreeServieVue => ({
	session: 's1',
	moment: 'message',
	horodatageMs,
	ids: [],
	texte: '',
	ms: 1,
	sens: false,
	classement: [],
	muet: null,
	cartes: cartes.map((id) => ({ id, titre: id.toUpperCase(), raison: 'question' as const })),
	...(titres === undefined ? {} : { titres }),
});

describe('fichesProposees', () => {
	it('sans doublon, plus récentes d’abord, hors fiches servies', () => {
		const entrees = [entree(1, ['a.md', 'b.md']), entree(2, ['c.md', 'a.md'])];
		expect(fichesProposees(entrees, ['b.md'])).toEqual(['c.md', 'a.md']);
	});
});

describe('titresConnus', () => {
	it('le titre le plus récent l’emporte', () => {
		const entrees = [entree(1, ['a.md'], { 'p.md': 'Ancien' }), entree(2, [], { 'p.md': 'Récent' })];
		expect(titresConnus(entrees).get('p.md')).toBe('Récent');
		expect(titresConnus(entrees).get('a.md')).toBe('A.MD');
	});
});
