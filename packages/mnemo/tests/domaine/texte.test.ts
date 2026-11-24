import { describe, expect, it } from 'vitest';
import { tronquerTexte } from '../../src/domaine/texte.ts';

describe('tronquerTexte', () => {
	it('compte en points de code par défaut, sans couper une paire de substitution', () => {
		expect(tronquerTexte('a😀b', 2)).toBe('a😀');
		expect(tronquerTexte('abc', 5)).toBe('abc');
		expect(tronquerTexte('abc', 0)).toBe('');
	});

	it('en unités UTF-16 (longueur JavaScript) : le plus long début qui tient, jamais une demi-paire', () => {
		expect(tronquerTexte('a😀b', 2, 'utf16')).toBe('a');
		expect(tronquerTexte('a😀b', 3, 'utf16')).toBe('a😀');
		expect(tronquerTexte('a😀b', 4, 'utf16')).toBe('a😀b');
		expect(tronquerTexte('😀😀', 1, 'utf16')).toBe('');
	});
});
