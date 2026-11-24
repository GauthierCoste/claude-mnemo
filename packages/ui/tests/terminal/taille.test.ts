import { describe, expect, it } from 'vitest';
import { ATTENTE_REDIMENSION_MS, TAILLE_MIN, tailleAEnvoyer } from '../../src/terminal/taille.ts';

describe('tailleAEnvoyer', () => {
	it('valeurs fixées', () => {
		expect(TAILLE_MIN).toEqual({ colonnes: 20, lignes: 5 });
		expect(ATTENTE_REDIMENSION_MS).toBe(120);
	});

	it('proposée nulle (cellule cachée) → null', () => {
		expect(tailleAEnvoyer(null, null)).toBeNull();
		expect(tailleAEnvoyer(null, { colonnes: 80, lignes: 24 })).toBeNull();
	});

	it('0×0 → null', () => {
		expect(tailleAEnvoyer({ colonnes: 0, lignes: 0 }, null)).toBeNull();
	});

	it('sous le minimum (19×40, 80×4) → null', () => {
		expect(tailleAEnvoyer({ colonnes: 19, lignes: 40 }, null)).toBeNull();
		expect(tailleAEnvoyer({ colonnes: 80, lignes: 4 }, null)).toBeNull();
		expect(tailleAEnvoyer({ colonnes: 20, lignes: 5 }, null)).toEqual({ colonnes: 20, lignes: 5 });
	});

	it('identique à la dernière envoyée → null', () => {
		expect(tailleAEnvoyer({ colonnes: 80, lignes: 24 }, { colonnes: 80, lignes: 24 })).toBeNull();
	});

	it('nouvelle → la taille proposée', () => {
		expect(tailleAEnvoyer({ colonnes: 120, lignes: 30 }, null)).toEqual({ colonnes: 120, lignes: 30 });
		expect(tailleAEnvoyer({ colonnes: 120, lignes: 31 }, { colonnes: 120, lignes: 30 })).toEqual({ colonnes: 120, lignes: 31 });
	});
});
