/** Texte de `hooks.json` de Codex : lu sans BOM, réécrit avec son indentation, ses fins de ligne et son BOM. */
import { describe, expect, it } from 'vitest';
import { sansBom, texteJsonReecrit } from '../../src/domaine/moteurs/codex/json-texte.ts';

describe('hooks.json de Codex', () => {
	it('BOM : retiré à la lecture, remis à l’écriture', () => {
		expect(sansBom('\uFEFF{}')).toBe('{}');
		expect(sansBom('{}')).toBe('{}');
		expect(texteJsonReecrit({ a: 1 }, '\uFEFF{\n\t"a": 0\n}')).toBe('\uFEFF{\n\t"a": 1\n}\n');
	});

	it('style : indentation de la première ligne indentée (tabulation ou espaces), CRLF ; une fin de ligne finale', () => {
		expect(texteJsonReecrit({ a: 1 }, null)).toBe('{\n  "a": 1\n}\n');
		expect(texteJsonReecrit({ a: 1 }, '{\n    "a": 0\n}')).toBe('{\n    "a": 1\n}\n');
		expect(texteJsonReecrit({ a: [1] }, '{\r\n\t"a": 0\r\n}')).toBe('{\r\n\t"a": [\r\n\t\t1\r\n\t]\r\n}\r\n');
		expect(texteJsonReecrit({ a: 1 }, '{"a": 0}')).toBe('{\n  "a": 1\n}\n');
	});
});
