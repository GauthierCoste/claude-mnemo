import { describe, expect, it } from 'vitest';
import { CAPACITE_TAMPON, tamponCirculaire } from '../../src/domaine/tampon.ts';

describe('tamponCirculaire', () => {
	it('256 Ko par session', () => {
		expect(CAPACITE_TAMPON).toBe(256 * 1024);
	});

	it('rend tout ce qui a été ajouté tant que la capacité tient', () => {
		const t = tamponCirculaire(10);
		expect(t.lire()).toBe('');
		t.ajouter('abc');
		t.ajouter('');
		t.ajouter('def');
		expect(t.lire()).toBe('abcdef');
		expect(t.lire()).toBe('abcdef');
	});

	it('borné : garde les derniers caractères, coupe au milieu d’un morceau', () => {
		const t = tamponCirculaire(5);
		t.ajouter('abc');
		t.ajouter('defg');
		expect(t.lire()).toBe('cdefg');
		t.ajouter('hi');
		expect(t.lire()).toBe('efghi');
	});

	it('un morceau plus grand que la capacité : sa fin seulement', () => {
		const t = tamponCirculaire(4);
		t.ajouter('xy');
		t.ajouter('0123456789');
		expect(t.lire()).toBe('6789');
	});

	it('ne coupe jamais un caractère hors du plan de base (paire de substitution)', () => {
		const t = tamponCirculaire(2);
		t.ajouter('a😀b');
		// « a😀b » fait 4 unités ; garder les 2 dernières couperait l'émoji en deux : il part entier
		expect(t.lire()).toBe('b');
		const u = tamponCirculaire(3);
		u.ajouter('a');
		u.ajouter('😀');
		u.ajouter('bc');
		expect(u.lire()).toBe('bc');
	});

	it('reste borné sous un flot de 20 Mo', () => {
		const t = tamponCirculaire(CAPACITE_TAMPON);
		const bloc = 'x'.repeat(64 * 1024);
		for (let i = 0; i < 320; i++) t.ajouter(bloc);
		t.ajouter('fin');
		const lu = t.lire();
		expect(lu.length).toBe(CAPACITE_TAMPON);
		expect(lu.endsWith('xfin')).toBe(true);
	});
});
