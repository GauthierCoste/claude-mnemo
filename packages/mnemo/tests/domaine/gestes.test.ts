import { describe, expect, it } from 'vitest';
import { compterGestes, origineDe } from '../../src/domaine/gestes.ts';

describe('gestes', () => {
	it('origine : l’utilisateur pour ➤, ✗ et rétablir ; Claude pour une lecture après carte ; auto pour une injection automatique', () => {
		expect(origineDe('injectee_main')).toBe('utilisateur');
		expect(origineDe('ecartee_ici')).toBe('utilisateur');
		expect(origineDe('ecartee_toujours')).toBe('utilisateur');
		expect(origineDe('retablie')).toBe('utilisateur');
		expect(origineDe('lue_apres_carte')).toBe('claude');
		expect(origineDe('injectee_auto')).toBe('auto');
	});

	it('comptes par geste et par fiche (total décroissant, puis chemin)', () => {
		const comptes = compterGestes([
			{ geste: 'ecartee_ici', fiche: 'b.md', nombre: 2 },
			{ geste: 'injectee_main', fiche: 'a.md', nombre: 1 },
			{ geste: 'lue_apres_carte', fiche: 'a.md', nombre: 3 },
			{ geste: 'retablie', fiche: 'c.md', nombre: 2 },
		]);
		expect(comptes.total).toBe(8);
		expect(comptes.parGeste).toEqual({ injectee_main: 1, ecartee_ici: 2, ecartee_toujours: 0, retablie: 2, lue_apres_carte: 3, injectee_auto: 0 });
		expect(comptes.parFiche).toEqual([
			{ fiche: 'a.md', total: 4, parGeste: { injectee_main: 1, lue_apres_carte: 3 } },
			{ fiche: 'b.md', total: 2, parGeste: { ecartee_ici: 2 } },
			{ fiche: 'c.md', total: 2, parGeste: { retablie: 2 } },
		]);
		expect(compterGestes([])).toMatchObject({ total: 0, parFiche: [] });
	});
});
