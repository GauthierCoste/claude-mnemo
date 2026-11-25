/** Textes de configuration des moteurs : JSONC lu avec tolérance, réécrit avec son indentation, ses fins de ligne et son BOM. */
import { describe, expect, it } from 'vitest';
import { lireJsonc, sansBom, sansCommentairesJson, styleJson, texteJson, texteJsonReecrit } from '../../src/domaine/moteurs/json-texte.ts';

describe('JSONC', () => {
	it('commentaires et virgules finales retirés en une passe, jamais dans une chaîne', () => {
		const texte = '{\n  // ligne\n  "a": "x // y /* z */", /* bloc */\n  "b": [1, 2,],\n  "c": "\\"",\n}\n';
		expect(JSON.parse(sansCommentairesJson(texte))).toEqual({ a: 'x // y /* z */', b: [1, 2], c: '"' });
		expect(lireJsonc(texte)).toEqual({ valeur: { a: 'x // y /* z */', b: [1, 2], c: '"' }, jsonc: true });
		expect(lireJsonc('{"a": 1}')).toEqual({ valeur: { a: 1 }, jsonc: false });
		expect(lireJsonc('  ')).toEqual({ valeur: {}, jsonc: false });
		expect(lireJsonc('{"a": ')).toHaveProperty('echec');
	});

	it('virgule finale suivie d’un commentaire avant la fermeture ; virgule dans une chaîne gardée ; URL avec //', () => {
		expect(JSON.parse(sansCommentairesJson('{"a": [1, /* c */ ], // d\n}'))).toEqual({ a: [1] });
		expect(JSON.parse(sansCommentairesJson('{"a": ",]", "u": "http://x//y"}'))).toEqual({ a: ',]', u: 'http://x//y' });
	});

	it('BOM : retiré à la lecture (ce n’est pas du JSONC), remis à l’écriture', () => {
		expect(sansBom('\uFEFF{}')).toBe('{}');
		expect(lireJsonc('\uFEFF{"a":1}')).toEqual({ valeur: { a: 1 }, jsonc: false });
		expect(styleJson('\uFEFF{\n\t"a": 1\n}')).toEqual({ indentation: '\t', finDeLigne: '\n', bom: true });
		expect(texteJsonReecrit({ a: 1 }, '\uFEFF{\n\t"a": 0\n}')).toBe('\uFEFF{\n\t"a": 1\n}\n');
	});

	it('style : indentation de la première ligne indentée (tabulation ou espaces), CRLF ; réécrit avec une fin de ligne finale', () => {
		expect(styleJson(null)).toEqual({ indentation: '  ', finDeLigne: '\n', bom: false });
		expect(styleJson('{\n    "a": 1\n}')).toEqual({ indentation: '    ', finDeLigne: '\n', bom: false });
		expect(styleJson('{\r\n\t"a": 1\r\n}')).toEqual({ indentation: '\t', finDeLigne: '\r\n', bom: false });
		expect(styleJson('{"a": 1}')).toEqual({ indentation: '  ', finDeLigne: '\n', bom: false });
		expect(texteJson({ a: [1] }, { indentation: '\t', finDeLigne: '\r\n', bom: false })).toBe('{\r\n\t"a": [\r\n\t\t1\r\n\t]\r\n}\r\n');
		expect(texteJsonReecrit({ a: 1 }, null)).toBe('{\n  "a": 1\n}\n');
	});
});
