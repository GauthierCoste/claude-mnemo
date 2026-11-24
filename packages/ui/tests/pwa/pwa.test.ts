import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ICONES, pngIcone, svgIcone } from '../../outils/icone.ts';

const RACINE = join(import.meta.dirname, '..', '..');
const PUBLIC = join(RACINE, 'public');

type Manifest = {
	name: string;
	short_name: string;
	display: string;
	start_url: string;
	scope: string;
	theme_color: string;
	background_color: string;
	icons: { src: string; sizes: string; type: string; purpose?: string }[];
};

const manifest = (): Manifest => JSON.parse(readFileSync(join(PUBLIC, 'manifest.webmanifest'), 'utf8')) as Manifest;

/** Largeur et hauteur d'un PNG (en-tête IHDR), après vérification de la signature. */
function dimensionsPng(octets: Buffer): { largeur: number; hauteur: number } {
	expect(octets.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
	expect(octets.subarray(12, 16).toString('latin1')).toBe('IHDR');
	return { largeur: octets.readUInt32BE(16), hauteur: octets.readUInt32BE(20) };
}

const jeton = (nom: string): string => {
	const css = readFileSync(join(RACINE, 'src', 'styles', 'jetons.css'), 'utf8');
	return new RegExp(`${nom}\\s*:\\s*([^;]+);`).exec(css)![1]!.trim();
};

describe('application installable (PWA)', () => {
	it('manifest : « Mnemo », fenêtre propre (standalone), départ et portée à la racine, couleurs de l’interface', () => {
		const m = manifest();
		expect(m.name).toBe('Mnemo');
		expect(m.short_name).toBe('Mnemo');
		expect(m.display).toBe('standalone');
		expect(m.start_url).toBe('/');
		expect(m.scope).toBe('/');
		expect(m.theme_color).toBe(jeton('--bg'));
		expect(m.background_color).toBe(jeton('--bg'));
	});

	it('manifest : icônes 192 et 512 (any) et 512 maskable, PNG présents aux bonnes dimensions', () => {
		const { icons } = manifest();
		const voulues = [
			{ sizes: '192x192', purpose: 'any' },
			{ sizes: '512x512', purpose: 'any' },
			{ sizes: '512x512', purpose: 'maskable' },
		];
		for (const v of voulues) {
			const icone = icons.find((i) => i.sizes === v.sizes && (i.purpose ?? 'any') === v.purpose);
			expect(icone, `${v.sizes} ${v.purpose}`).toBeDefined();
			expect(icone!.type).toBe('image/png');
			expect(icone!.src.startsWith('/icones/')).toBe(true);
			const taille = Number(v.sizes.split('x')[0]);
			expect(dimensionsPng(readFileSync(join(PUBLIC, icone!.src)))).toEqual({ largeur: taille, hauteur: taille });
		}
	});

	it('icônes versionnées = celles que dessine outils/icone.ts (le SVG source et les PNG ne divergent pas)', () => {
		expect(readFileSync(join(PUBLIC, 'icone.svg'), 'utf8')).toBe(svgIcone('standard'));
		const petite = ICONES.find((i) => i.taille === 192 && i.variante === 'standard')!;
		expect(readFileSync(join(PUBLIC, 'icones', petite.fichier)).equals(pngIcone(192, 'standard'))).toBe(true);
		for (const i of ICONES) expect(dimensionsPng(readFileSync(join(PUBLIC, 'icones', i.fichier)))).toEqual({ largeur: i.taille, hauteur: i.taille });
	});

	it('service worker : aucun cache (ni Cache Storage, ni IndexedDB), rien de l’API ni du WebSocket intercepté', () => {
		const sw = readFileSync(join(PUBLIC, 'sw.js'), 'utf8');
		expect(sw).not.toMatch(/caches|indexedDB|localStorage/u);
		expect(sw).toMatch(/addEventListener\('fetch'/u);
		// seules les navigations passent par lui, telles quelles
		expect(sw).toMatch(/mode !== 'navigate'/u);
	});

	it('index.html : manifeste, icône et couleur du thème ; le service worker est enregistré par main.tsx', () => {
		const html = readFileSync(join(RACINE, 'index.html'), 'utf8');
		expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
		expect(html).toContain('<link rel="icon" href="/icone.svg" type="image/svg+xml" />');
		expect(html).toContain(`<meta name="theme-color" content="${jeton('--bg')}" />`);
		expect(readFileSync(join(RACINE, 'src', 'main.tsx'), 'utf8')).toMatch(/serviceWorker\.register\('\/sw\.js'/u);
	});
});
