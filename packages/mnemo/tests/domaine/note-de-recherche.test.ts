import { describe, expect, it } from 'vitest';
import { fraicheur, libelleApports, noterRecherche, POIDS_RECHERCHE_PAR_DEFAUT } from '../../src/domaine/note-de-recherche.ts';
import type { Faits, PoidsRecherche } from '../../src/domaine/note-de-recherche.ts';

const faits = (surcharge: Partial<Faits> = {}): Faits => ({ dansVoisinage: false, confiance: 1, deLaMemoire: false, date: null, aujourdhui: '2026-11-24', ...surcharge });
const sansFraicheur: PoidsRecherche = { ...POIDS_RECHERCHE_PAR_DEFAUT, fraicheur: 0 };

describe('noterRecherche', () => {
	it('défauts : 0,10 position, 0,10 confiance, 0,05 mémoire, 0,05 fraîcheur', () => {
		expect(POIDS_RECHERCHE_PAR_DEFAUT).toEqual({ position: 0.1, confiance: 0.1, memoire: 0.05, fraicheur: 0.05 });
	});

	it('total = base + somme des apports', () => {
		const n = noterRecherche(0.5, faits({ dansVoisinage: true, deLaMemoire: true, confiance: 0.5, date: '2026-11-24' }), POIDS_RECHERCHE_PAR_DEFAUT);
		expect(n.apports.map((a) => a.poids)).toEqual(['position', 'confiance', 'memoire', 'fraicheur']);
		expect(n.total).toBeCloseTo(0.5 + 0.1 - 0.05 + 0.05 + 0.05, 10);
		expect(n.total).toBeCloseTo(n.apports.reduce((s, a) => s + a.valeur, n.base), 10);
	});

	it('confiance 1 : pas d’apport « confiance » ; aucun autre fait : seule la fraîcheur (date absente) compte', () => {
		const n = noterRecherche(0.4, faits(), POIDS_RECHERCHE_PAR_DEFAUT);
		expect(n.apports.map((a) => a.poids)).toEqual(['fraicheur']);
		expect(n.total).toBeCloseTo(0.45, 10);
	});

	it('confiance 0,51 : apport de −0,049', () => {
		const n = noterRecherche(0.5, faits({ confiance: 0.51 }), sansFraicheur);
		expect(n.apports).toHaveLength(1);
		expect(n.apports[0]!.poids).toBe('confiance');
		expect(n.apports[0]!.valeur).toBeCloseTo(-0.049, 10);
	});

	it('un an : fraîcheur de 0,025 (la moitié du poids)', () => {
		const n = noterRecherche(0.5, faits({ date: '2025-11-24' }), POIDS_RECHERCHE_PAR_DEFAUT);
		expect(n.apports).toHaveLength(1);
		expect(n.apports[0]!.valeur).toBeCloseTo(0.025, 10);
	});

	it('un poids à 0 n’est pas listé', () => {
		const n = noterRecherche(0.5, faits({ dansVoisinage: true, deLaMemoire: true, confiance: 0.5 }), { position: 0, confiance: 0, memoire: 0, fraicheur: 0 });
		expect(n).toEqual({ base: 0.5, apports: [], total: 0.5 });
	});
});

describe('fraicheur', () => {
	it('1 sans date ou date mal formée, 1 pour une date future, 0,5 après un an', () => {
		expect(fraicheur(null, '2026-11-24')).toBe(1);
		expect(fraicheur('hier', '2026-11-24')).toBe(1);
		expect(fraicheur('2027-01-01', '2026-11-24')).toBe(1);
		expect(fraicheur('2025-11-24', '2026-11-24')).toBeCloseTo(0.5, 10);
	});
});

describe('libelleApports', () => {
	it('base en virgule à deux décimales, puis les apports en clair', () => {
		const n = noterRecherche(0.82, faits({ dansVoisinage: true, confiance: 0.6 }), sansFraicheur);
		expect(libelleApports(n)).toBe('0,82 · projet courant, confiance 60 %');
	});

	it('« récent » seulement pour un élément daté de moins d’un an ; « mémoire » jamais dit ; sans raison : la base seule', () => {
		const recent = noterRecherche(0.5, faits({ deLaMemoire: true, date: '2026-11-24' }), POIDS_RECHERCHE_PAR_DEFAUT);
		expect(libelleApports(recent)).toBe('0,50 · récent');
		// les apports restent dans la note : seul le libellé les tait
		expect(recent.apports.map((a) => a.poids)).toEqual(['memoire', 'fraicheur']);
		const sansDate = noterRecherche(0.5, faits({ deLaMemoire: true }), POIDS_RECHERCHE_PAR_DEFAUT);
		expect(sansDate.apports.map((a) => a.poids)).toEqual(['memoire', 'fraicheur']);
		expect(libelleApports(sansDate)).toBe('0,50');
		expect(libelleApports(noterRecherche(0.5, faits({ date: '2024-11-24' }), POIDS_RECHERCHE_PAR_DEFAUT))).toBe('0,50');
		expect(libelleApports({ base: 0.3, apports: [] })).toBe('0,30');
	});
});
