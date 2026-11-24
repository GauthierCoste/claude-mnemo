import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const RACINE = join(import.meta.dirname, '..', '..');
let sortie = '';

function fichiers(dossier: string): string[] {
	return readdirSync(dossier).flatMap((n) => {
		const c = join(dossier, n);
		return statSync(c).isDirectory() ? fichiers(c) : [c];
	});
}

beforeAll(async () => {
	sortie = mkdtempSync(join(tmpdir(), 'mnemo-ui-dist-'));
	// Vitest pose NODE_ENV=test, que Vite garderait (import.meta.env.DEV vrai) : on construit comme `pnpm construire`.
	const avant = process.env['NODE_ENV'];
	process.env['NODE_ENV'] = 'production';
	try {
		await build({ root: RACINE, configFile: join(RACINE, 'vite.config.ts'), mode: 'production', logLevel: 'silent', build: { outDir: sortie, emptyOutDir: true } });
	} finally {
		if (avant === undefined) delete process.env['NODE_ENV'];
		else process.env['NODE_ENV'] = avant;
	}
}, 120_000);

afterAll(() => rmSync(sortie, { recursive: true, force: true }));

describe('construction', () => {
	it('produit index.html et ses fichiers', () => {
		expect(readFileSync(join(sortie, 'index.html'), 'utf8')).toContain('./assets/');
		expect(fichiers(sortie).some((f) => f.endsWith('.js'))).toBe(true);
	});

	it('porte l’application installable : manifeste lié, service worker, icônes', () => {
		const html = readFileSync(join(sortie, 'index.html'), 'utf8');
		expect(html).toContain('rel="manifest"');
		for (const f of ['manifest.webmanifest', 'sw.js', 'icone.svg', 'icones/icone-192.png', 'icones/icone-512.png', 'icones/icone-masquable-512.png'])
			expect(statSync(join(sortie, f)).isFile(), f).toBe(true);
	});

	it('le mode démo et ses données ne sont jamais dans la construction', () => {
		const traces = ['Refondre le module stocks pour gérer les lots', 'Marc Lefèvre', 'demo'];
		for (const f of fichiers(sortie)) {
			const texte = readFileSync(f, 'utf8');
			for (const t of traces) expect(texte.includes(t), `${t} dans ${f}`).toBe(false);
		}
	});
});
