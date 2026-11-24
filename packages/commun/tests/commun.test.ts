import { describe, expect, it } from 'vitest';
import { CARACTERES_INVISIBLES, echapperPourRegex, libelleRaison, plier, sansAccents, tailleLisible } from '../src/index.ts';

describe('commun', () => {
	it('libelleRaison : « <raison> à <titre> » quand la fiche d’où vient le poids est connue, le libellé de la raison sinon', () => {
		expect(libelleRaison('liee', 'Avoirs')).toBe('liée à Avoirs');
		expect(libelleRaison('liee')).toBe('liée');
		expect(libelleRaison('liee', null)).toBe('liée');
		expect(libelleRaison('liee', '')).toBe('liée');
		expect(libelleRaison('perimetre', null)).toBe('du périmètre');
		expect(libelleRaison('nommee')).toBe('nommée');
	});

	it('sansAccents garde la casse ; plier met en minuscules', () => {
		expect(sansAccents('Écoles Œuvre ñ')).toBe('Ecoles Œuvre n');
		expect(plier('Réunion')).toBe('reunion');
	});

	it('CARACTERES_INVISIBLES : contrôles et marques de direction refusés, lettres acceptées', () => {
		for (const c of ['\u0000', '\u001f', '\u007f', '\u0085', '\u061c', '\u200e', '\u200f', '\u202e', '\u2066']) expect(CARACTERES_INVISIBLES.test(c), c.codePointAt(0)!.toString(16)).toBe(true);
		for (const c of ['a', 'é', ' ', '-']) expect(CARACTERES_INVISIBLES.test(c)).toBe(false);
	});

	it('tailleLisible : unités binaires, une décimale', () => {
		expect(tailleLisible(512)).toBe('512 octets');
		expect(tailleLisible(1.5 * 1024 ** 3)).toBe('1,5 Go');
	});

	it('echapperPourRegex : chaque caractère spécial du motif est pris littéralement', () => {
		const brut = 'a.b*c+(d)[e]{f}|g^h$i?j\\k/l';
		expect(new RegExp(`^${echapperPourRegex(brut)}$`, 'u').test(brut)).toBe(true);
		expect(new RegExp(`^${echapperPourRegex('a.b')}$`, 'u').test('axb')).toBe(false);
	});
});
