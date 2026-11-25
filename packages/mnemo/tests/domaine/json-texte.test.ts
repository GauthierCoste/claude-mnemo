/** Textes de configuration des moteurs : lus sans BOM, réécrits avec leur indentation, leurs fins de ligne et leur BOM. */
import { describe, expect, it } from 'vitest';
import { sansBom, styleJson, texteJson, texteJsonReecrit } from '../../src/domaine/moteurs/json-texte.ts';

describe('JSON des moteurs', () => {
	it('BOM : retiré à la lecture, remis à l’écriture', () => {
		expect(sansBom('\uFEFF{}')).toBe('{}');
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
