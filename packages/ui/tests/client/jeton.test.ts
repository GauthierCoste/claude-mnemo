import { describe, expect, it, vi } from 'vitest';
import { effacerJetonDeLAdresse, lireJeton, oublierJeton } from '../../src/client/jeton.ts';

const J = 'a'.repeat(32) + '0123456789abcdef'.repeat(2);
const K = 'b'.repeat(64);

function stockage(initial: Record<string, string> = {}) {
	const valeurs = new Map(Object.entries(initial));
	return { valeurs, getItem: (k: string) => valeurs.get(k) ?? null, setItem: (k: string, v: string) => void valeurs.set(k, v), removeItem: (k: string) => void valeurs.delete(k) };
}

const bloque = {
	getItem: () => {
		throw new Error('bloqué');
	},
	setItem: () => {
		throw new Error('bloqué');
	},
	removeItem: () => {
		throw new Error('bloqué');
	},
};

describe('lireJeton (stockage de l’origine)', () => {
	it('prend le jeton du fragment et le range dans le stockage (le suivant prend le pas sur l’ancien)', () => {
		const s = stockage({ 'mnemo.jeton': K });
		expect(lireJeton(`#jeton=${J}`, s)).toBe(J);
		expect(s.valeurs.get('mnemo.jeton')).toBe(J);
	});

	it('sans fragment, ou fragment invalide : le jeton gardé ; rien de valable → null', () => {
		expect(lireJeton('', stockage({ 'mnemo.jeton': K }))).toBe(K);
		expect(lireJeton('#jeton=pas-un-jeton', stockage({ 'mnemo.jeton': K }))).toBe(K);
		expect(lireJeton('', stockage())).toBeNull();
		expect(lireJeton('', null)).toBeNull();
		expect(lireJeton(`#jeton=${J.slice(1)}`, stockage())).toBeNull();
		expect(lireJeton('', stockage({ 'mnemo.jeton': K.slice(1) }))).toBeNull();
	});

	it('stockage bloqué : le fragment vaut pour la page ; sans fragment, null (écran du jeton)', () => {
		expect(lireJeton(`#jeton=${J}`, bloque)).toBe(J);
		expect(lireJeton('', bloque)).toBeNull();
		expect(() => oublierJeton(bloque)).not.toThrow();
	});

	it('oublierJeton efface le jeton gardé', () => {
		const s = stockage({ 'mnemo.jeton': K });
		oublierJeton(s);
		expect(s.valeurs.has('mnemo.jeton')).toBe(false);
	});
});

describe('effacerJetonDeLAdresse', () => {
	it('garde chemin et requête, retire le fragment', () => {
		const h = { replaceState: vi.fn() };
		effacerJetonDeLAdresse(h, `http://127.0.0.1:4100/ui/?demo=1&x=2#jeton=${J}`);
		expect(h.replaceState).toHaveBeenCalledWith(null, '', '/ui/?demo=1&x=2');
	});
});
