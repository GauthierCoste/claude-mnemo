import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

// Processus principal d'Electron : un seul fichier ESM pour Node (`dist/main.js`), dépendances comprises (le paquet de
// l'app n'emporte pas de node_modules) ; `electron` et les modules de Node restent des imports, fournis à l'exécution.
const EXTERNES = ['electron', /^node:/u, ...builtinModules];

export default defineConfig({
	// `ressources/` (images de la barre des menus) copié tel quel dans `dist/` : le paquet de l'app n'emporte que `dist/`
	publicDir: 'ressources',
	build: {
		copyPublicDir: true,
		ssr: 'src/main.ts',
		outDir: 'dist',
		emptyOutDir: true,
		target: 'node22',
		minify: false,
		sourcemap: true,
		rollupOptions: {
			external: EXTERNES,
			output: { format: 'es', entryFileNames: 'main.js' },
		},
	},
	ssr: { target: 'node', noExternal: true, external: ['electron'] },
});
