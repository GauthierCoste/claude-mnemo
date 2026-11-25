/** Textes de configuration des moteurs : JSONC lu avec tolérance, réécrit dans son style ; chemins écrits par un patch. */
import { describe, expect, it } from 'vitest';
import { lireJsonc, sansCommentairesJson, styleJson, texteJson } from '../../src/domaine/moteurs/json-texte.ts';
import { cheminsDuPatch, cheminsEcritsDuPatch } from '../../src/domaine/moteurs/patch.ts';

describe('JSONC', () => {
	it('commentaires et virgules finales retirés, jamais dans une chaîne', () => {
		const texte = '{\n  // ligne\n  "a": "x // y /* z */", /* bloc */\n  "b": [1, 2,],\n  "c": "\\"",\n}\n';
		expect(JSON.parse(sansCommentairesJson(texte))).toEqual({ a: 'x // y /* z */', b: [1, 2], c: '"' });
		expect(lireJsonc(texte)).toEqual({ valeur: { a: 'x // y /* z */', b: [1, 2], c: '"' }, jsonc: true });
		expect(lireJsonc('{"a": 1}')).toEqual({ valeur: { a: 1 }, jsonc: false });
		expect(lireJsonc('  ')).toEqual({ valeur: {}, jsonc: false });
		expect(lireJsonc('{"a": ')).toHaveProperty('echec');
	});

	it('style : indentation de la première ligne indentée (tabulation ou espaces), CRLF ; réécrit avec une fin de ligne finale', () => {
		expect(styleJson(null)).toEqual({ indentation: '  ', finDeLigne: '\n' });
		expect(styleJson('{\n    "a": 1\n}')).toEqual({ indentation: '    ', finDeLigne: '\n' });
		expect(styleJson('{\r\n\t"a": 1\r\n}')).toEqual({ indentation: '\t', finDeLigne: '\r\n' });
		expect(styleJson('{"a": 1}')).toEqual({ indentation: '  ', finDeLigne: '\n' });
		expect(texteJson({ a: [1] }, { indentation: '\t', finDeLigne: '\r\n' })).toBe('{\r\n\t"a": [\r\n\t\t1\r\n\t]\r\n}\r\n');
	});
});

describe('patch', () => {
	it('chemins des en-têtes, sans doublon ; illisible : absent, ou du contenu sans en-tête ; vide : rien', () => {
		const patch = '*** Begin Patch\n*** Add File: a.md\n+x\n*** Update File: b.md\n*** Move to: c.md\n*** Delete File: a.md\n*** End Patch';
		expect(cheminsDuPatch(patch)).toEqual(['a.md', 'b.md', 'c.md']);
		expect(cheminsEcritsDuPatch(patch)).toEqual(['a.md', 'b.md', 'c.md']);
		expect(cheminsEcritsDuPatch(null)).toBe('illisible');
		expect(cheminsEcritsDuPatch('rm -rf /')).toBe('illisible');
		expect(cheminsEcritsDuPatch('*** Begin Patch\n*** End Patch\n')).toEqual([]);
	});
});
