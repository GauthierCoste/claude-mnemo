import { join } from 'node:path';
import { defineConfig } from 'vite';

// Page de l'assistant d'installation (`src/assistant/index.html`) : construite après le processus principal, dans
// `dist/assistant/` (que `construire-app` emporte avec `main.js`). Chargée en `file://` : chemins relatifs ; aucun script
// en ligne (la CSP de la page n'autorise que ses propres fichiers), d'où ni préchargement de modules ni polyfill.
const RACINE = join(import.meta.dirname, 'src', 'assistant');

export default defineConfig({
	root: RACINE,
	base: './',
	publicDir: false,
	build: {
		outDir: join(import.meta.dirname, 'dist', 'assistant'),
		emptyOutDir: true,
		target: 'chrome140',
		minify: false,
		sourcemap: false,
		modulePreload: false,
		assetsInlineLimit: 0,
		rollupOptions: { input: join(RACINE, 'index.html') },
	},
});
