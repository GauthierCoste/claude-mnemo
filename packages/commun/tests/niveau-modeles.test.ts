import { describe, expect, it } from 'vitest';
import { estNiveauModeles, modelesPermis, niveauEffectif, niveauRetireUnModele, NIVEAUX_MODELES } from '../src/index.ts';

describe('niveaux des modèles', () => {
	it('niveau effectif : le plus restrictif du global et de celui de la session', () => {
		expect(niveauEffectif('complets', null)).toBe('complets');
		expect(niveauEffectif('sens', null)).toBe('sens');
		expect(niveauEffectif('complets', 'sens')).toBe('sens');
		expect(niveauEffectif('complets', 'coupes')).toBe('coupes');
		expect(niveauEffectif('sens', 'complets')).toBe('sens');
		expect(niveauEffectif('coupes', 'complets')).toBe('coupes');
		expect(niveauEffectif('coupes', 'sens')).toBe('coupes');
		expect(niveauEffectif('sens', 'coupes')).toBe('coupes');
		for (const n of NIVEAUX_MODELES) expect(niveauEffectif(n, n)).toBe(n);
	});

	it('modèles permis par chaque niveau', () => {
		expect(modelesPermis('complets')).toEqual({ sens: true, reranker: true });
		expect(modelesPermis('sens')).toEqual({ sens: true, reranker: false });
		expect(modelesPermis('coupes')).toEqual({ sens: false, reranker: false });
	});

	it('un changement retire un modèle seulement vers un niveau plus restrictif', () => {
		expect(niveauRetireUnModele('complets', 'sens')).toBe(true);
		expect(niveauRetireUnModele('sens', 'coupes')).toBe(true);
		expect(niveauRetireUnModele('complets', 'coupes')).toBe(true);
		expect(niveauRetireUnModele('coupes', 'sens')).toBe(false);
		expect(niveauRetireUnModele('sens', 'complets')).toBe(false);
		expect(niveauRetireUnModele('sens', 'sens')).toBe(false);
	});

	it('estNiveauModeles reconnaît les trois niveaux seulement', () => {
		for (const n of NIVEAUX_MODELES) expect(estNiveauModeles(n)).toBe(true);
		for (const v of ['', 'Complets', 'aucun', null, undefined, 1, {}]) expect(estNiveauModeles(v)).toBe(false);
	});
});
