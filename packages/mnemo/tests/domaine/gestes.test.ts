import { describe, expect, it } from 'vitest';
import { compterGestes, derniereProposition, origineDe } from '../../src/domaine/gestes.ts';
import { gestesEnTexte } from '../../src/adaptateurs/cli/banc-contexte.ts';

describe('gestes', () => {
	it('origine : auto pour une injection automatique, manuelle sinon', () => {
		expect(origineDe('injectee_auto')).toBe('auto');
		expect(origineDe('injectee_main')).toBe('manuelle');
		expect(origineDe('ecartee_toujours')).toBe('manuelle');
	});

	it('comptes par geste et par fiche (total décroissant, puis chemin) ; rendus sans texte de message', () => {
		const comptes = compterGestes([
			{ geste: 'ecartee_ici', fiche: 'b.md' },
			{ geste: 'injectee_main', fiche: 'a.md' },
			{ geste: 'lue_apres_carte', fiche: 'a.md' },
			{ geste: 'retablie', fiche: 'c.md' },
		]);
		expect(comptes.total).toBe(4);
		expect(comptes.parGeste).toEqual({ injectee_main: 1, ecartee_ici: 1, ecartee_toujours: 0, retablie: 1, lue_apres_carte: 1, injectee_auto: 0 });
		expect(comptes.parFiche).toEqual([
			{ fiche: 'a.md', total: 2, parGeste: { injectee_main: 1, lue_apres_carte: 1 } },
			{ fiche: 'b.md', total: 1, parGeste: { ecartee_ici: 1 } },
			{ fiche: 'c.md', total: 1, parGeste: { retablie: 1 } },
		]);
		expect(gestesEnTexte(comptes).split('\n')).toEqual([
			'Gestes : 4 (injectee_main 1, ecartee_ici 1, ecartee_toujours 0, retablie 1, lue_apres_carte 1, injectee_auto 0)',
			'  a.md : 2 (injectee_main 1, lue_apres_carte 1)',
			'  b.md : 1 (ecartee_ici 1)',
			'  c.md : 1 (retablie 1)',
		]);
		expect(compterGestes([])).toMatchObject({ total: 0, parFiche: [] });
	});

	it('dernière proposition d’une fiche : la plus récente carte, null si jamais proposée', () => {
		const actions = [
			{ chemin: 'a.md', action: 'proposee', horodatageMs: 5 },
			{ chemin: 'a.md', action: 'lue', horodatageMs: 6 },
			{ chemin: 'a.md', action: 'proposee', horodatageMs: 9 },
			{ chemin: 'b.md', action: 'servie', horodatageMs: 7 },
		];
		expect(derniereProposition(actions, 'a.md')).toBe(9);
		expect(derniereProposition(actions, 'b.md')).toBeNull();
	});
});
