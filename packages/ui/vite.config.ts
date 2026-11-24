import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type ProxyOptions } from 'vite';

type ServiceLocal = { port: number; jeton: string };

/** Lit `.mnemo/service.json` du dossier Mnemo désigné par `MNEMO_DOSSIER` (mode dev seulement) ; null s'il est absent. */
function lireService(): ServiceLocal | null {
	const dossier = process.env['MNEMO_DOSSIER'];
	if (!dossier) return null;
	try {
		const brut = JSON.parse(readFileSync(join(resolve(dossier), '.mnemo', 'service.json'), 'utf8')) as Partial<ServiceLocal>;
		if (typeof brut.port !== 'number' || typeof brut.jeton !== 'string') return null;
		return { port: brut.port, jeton: brut.jeton };
	} catch {
		return null;
	}
}

/** Proxy vers le service : `Host` et `Origin` réécrits vers `127.0.0.1:<port>`, sinon le service refuse la requête. */
function proxyVers(port: number, ws: boolean): ProxyOptions {
	const cible = `127.0.0.1:${port}`;
	return {
		target: `http://${cible}`,
		ws,
		changeOrigin: true,
		configure(proxy) {
			proxy.on('proxyReq', (req) => {
				req.setHeader('Host', cible);
				if (req.getHeader('Origin')) req.setHeader('Origin', `http://${cible}`);
			});
			proxy.on('proxyReqWs', (req) => {
				req.setHeader('Host', cible);
				req.setHeader('Origin', `http://${cible}`);
			});
		},
	};
}

/** Affiche l'adresse à ouvrir (avec le jeton du service) au démarrage du serveur de dev. */
function annoncerAdresse(service: ServiceLocal | null): Plugin {
	return {
		name: 'mnemo-adresse',
		configureServer(serveur) {
			serveur.httpServer?.once('listening', () => {
				const message = service
					? `\n  Mnemo : http://127.0.0.1:5173/#jeton=${service.jeton}\n`
					: '\n  Mnemo : aucun service trouvé (MNEMO_DOSSIER=<dossier> pour le relier) ; démo : http://127.0.0.1:5173/?demo\n';
				setTimeout(() => serveur.config.logger.info(message), 0);
			});
		},
	};
}

export default defineConfig(() => {
	const service = lireService();
	return {
		base: './',
		plugins: [react(), annoncerAdresse(service)],
		// Le morceau du graphe porte three.js (≈ 600 ko, chargé à la première ouverture de l'onglet) : avertir au-delà.
		build: { outDir: 'dist', assetsInlineLimit: 0, target: 'es2023', emptyOutDir: true, chunkSizeWarningLimit: 700 },
		server: {
			host: '127.0.0.1',
			port: 5173,
			strictPort: true,
			proxy: service ? { '/api': proxyVers(service.port, false), '/ws': proxyVers(service.port, true) } : undefined,
		},
	};
});
