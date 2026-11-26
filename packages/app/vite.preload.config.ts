import { join } from 'node:path';
import { defineConfig } from 'vite';

// Preload de la fenêtre de l'assistant : un seul fichier CommonJS (`dist/assistant/preload.cjs`), car un preload en `sandbox`
// n'est pas chargé comme module ES ; `electron` reste un `require`, fourni à l'exécution. Construit après la page (qui vide
// `dist/assistant/`).
export default defineConfig({
	build: {
		ssr: join(import.meta.dirname, 'src', 'assistant', 'preload.ts'),
		outDir: join(import.meta.dirname, 'dist', 'assistant'),
		emptyOutDir: false,
		target: 'chrome140',
		minify: false,
		sourcemap: false,
		rollupOptions: {
			external: ['electron'],
			output: { format: 'cjs', entryFileNames: 'preload.cjs' },
		},
	},
	ssr: { noExternal: true, external: ['electron'] },
});
