import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ErreurConstruction } from '../../outils/erreur.ts';
import { ecrirePaquetJs, exportsEnJs, traduireFichier } from '../../outils/paquet-js.ts';

describe('paquet du dépôt traduit en JavaScript', () => {
	it('types effacés, imports relatifs .ts récrits en .js, imports de types retirés', () => {
		const js = traduireFichier(
			"import type { A } from './a.ts';\nimport { b, type C } from './b.ts';\nexport * from './c.ts';\nexport const d: A | C = b as A;\nconst e = await import('./e.ts');\n",
			'x.ts',
		);
		expect(js).not.toMatch(/\.ts['"]/u);
		expect(js).not.toMatch(/import type|: A/u);
		expect(js).toContain('from "./b.js"');
		expect(js).toContain('from "./c.js"');
		expect(js).toContain('import("./e.js")');
	});

	it('syntaxe invalide : refusée', () => {
		expect(() => traduireFichier('export const = ;', 'x.ts')).toThrow(ErreurConstruction);
	});

	it('exports : cibles .ts devenues .js, conditions et sous-chemins compris', () => {
		expect(exportsEnJs('./src/index.ts')).toBe('./src/index.js');
		expect(exportsEnJs({ '.': './src/index.ts', './x': { import: './src/x.ts' } })).toEqual({ '.': './src/index.js', './x': { import: './src/x.js' } });
	});

	it('paquet écrit : src en .js, package.json sans scripts ni dépendances de développement, dépendances données', async () => {
		const dossier = mkdtempSync(join(tmpdir(), 'mnemo-paquet-js-'));
		try {
			const source = join(dossier, 'source');
			mkdirSync(join(source, 'src', 'sous'), { recursive: true });
			writeFileSync(
				join(source, 'package.json'),
				JSON.stringify({ name: '@exemple/p', version: '1.0.0', type: 'module', exports: { '.': './src/index.ts' }, scripts: { test: 'x' }, devDependencies: { y: '1' }, dependencies: { '@exemple/q': 'workspace:*' } }),
			);
			writeFileSync(join(source, 'src', 'index.ts'), "export { f } from './sous/f.ts';\n");
			writeFileSync(join(source, 'src', 'sous', 'f.ts'), 'export const f = (n: number): number => n + 1;\n');
			const destination = join(dossier, 'node_modules', '@exemple', 'p');
			ecrirePaquetJs(source, destination, { '@exemple/q': '1.0.0' });
			expect(JSON.parse(readFileSync(join(destination, 'package.json'), 'utf8'))).toEqual({
				name: '@exemple/p',
				version: '1.0.0',
				type: 'module',
				exports: { '.': './src/index.js' },
				dependencies: { '@exemple/q': '1.0.0' },
			});
			const { f } = (await import(pathToFileURL(join(destination, 'src', 'index.js')).href)) as { f: (n: number) => number };
			expect(f(1)).toBe(2);

			writeFileSync(join(source, 'src', 'donnees.json'), '{}');
			expect(() => ecrirePaquetJs(source, join(dossier, 'autre'), {})).toThrow(/inattendu/u);
		} finally {
			rmSync(dossier, { recursive: true, force: true });
		}
	});
});
