import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { demanderBranchementsDansReglages, ongletRetenu, oublierSectionDemandee, retenirOnglet, sectionDemandeeALire } from '../../src/reglages/onglet-retenu.ts';
import { stockage } from '../aides/stockage.ts';

let stocke = new Map<string, string>();
beforeEach(() => {
	stocke = stockage();
});
afterEach(() => vi.unstubAllGlobals());

describe('onglet retenu de la vue Réglages', () => {
	it('Agents d’abord ; le dernier ouvert ensuite ; une valeur inconnue : Agents', () => {
		expect(ongletRetenu()).toBe('agents');
		retenirOnglet('documentation');
		expect(stocke.get('mnemo.reglages.onglet')).toBe('documentation');
		expect(ongletRetenu()).toBe('documentation');
		stocke.set('mnemo.reglages.onglet', 'autre');
		expect(ongletRetenu()).toBe('agents');
	});

	it('valeurs d’avant la 1.9 : Profils mène à Agents, Système et App Claude à Réglages', () => {
		for (const [ancien, nouveau] of [
			['profils', 'agents'],
			['systeme', 'reglages'],
			['app-claude', 'reglages'],
		] as const) {
			stocke.set('mnemo.reglages.onglet', ancien);
			expect(ongletRetenu()).toBe(nouveau);
		}
	});

	it('« Voir dans Réglages » : l’onglet Réglages retenu, la section Branchements demandée jusqu’à ce qu’elle soit oubliée', () => {
		demanderBranchementsDansReglages();
		expect(stocke.get('mnemo.reglages.onglet')).toBe('reglages');
		expect(sectionDemandeeALire()).toBe('branchements');
		expect(sectionDemandeeALire()).toBe('branchements');
		oublierSectionDemandee();
		expect(sectionDemandeeALire()).toBeNull();
	});
});
