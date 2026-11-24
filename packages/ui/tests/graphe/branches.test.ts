import { describe, expect, it } from 'vitest';
import { brancheDePremierNiveau, couleurDeBranche, rangsDesBranches, rangsDesFiches } from '../../src/graphe/branches.ts';
import { JETONS_BRANCHES } from '../../src/graphe/couleurs.ts';

const CHEMINS = ['Moi.md', 'projets/erp/Stocks.md', 'clients/durand/durand.md', 'Écoles/x.md'];

describe('couleur de branche', () => {
	it('branche de premier niveau : le premier dossier, « » pour une fiche de la racine', () => {
		expect(CHEMINS.map(brancheDePremierNiveau)).toEqual(['', 'projets', 'clients', 'Écoles']);
	});

	it('rangs : la racine comprise, ordre alphabétique de localeCompare sans langue', () => {
		expect([...rangsDesFiches(CHEMINS)]).toEqual([
			['', 0],
			['clients', 1],
			['Écoles', 2],
			['projets', 3],
		]);
	});

	it('couleur d’une fiche : le jeton du rang de sa branche ; branche inconnue : --dim', () => {
		const rangs = rangsDesBranches(CHEMINS.map(brancheDePremierNiveau));
		expect(couleurDeBranche(rangs, 'projets/erp/Stocks.md')).toBe(`var(${JETONS_BRANCHES[3]})`);
		expect(couleurDeBranche(rangs, 'Moi.md')).toBe(`var(${JETONS_BRANCHES[0]})`);
		expect(couleurDeBranche(rangs, 'inconnu/x.md')).toBe('var(--dim)');
	});
});
