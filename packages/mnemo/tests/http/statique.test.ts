import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTES } from '@mnemo/contrat';
import { dossierInterface } from '../../src/adaptateurs/http/statique.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { appeler, serviceFaux } from '../aides/service-faux.ts';

async function interfaceConstruite(): Promise<string> {
	const dist = await dossierTemporaire();
	await mkdir(join(dist, 'assets'));
	await writeFile(join(dist, 'index.html'), '<!doctype html><title>Mnemo</title><div id="racine"></div>');
	await writeFile(join(dist, 'assets', 'index-abc.js'), 'console.log(1);');
	await writeFile(join(dist, 'assets', 'index-abc.css'), 'body{}');
	await writeFile(join(dist, 'assets', '.cache.js'), 'secret');
	await writeFile(join(dist, 'service.json'), '{"jeton":"x"}');
	await writeFile(join(dist, 'manifest.webmanifest'), '{"name":"Mnemo"}');
	await writeFile(join(dist, 'sw.js'), "self.addEventListener('fetch', () => {});");
	await writeFile(join(dist, 'icone.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
	await mkdir(join(dist, 'icones'));
	await writeFile(join(dist, 'icones', 'icone-192.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
	await writeFile(join(dist, 'icones', '.cache.png'), 'secret');
	return dist;
}

describe('fichiers de l\'interface', () => {
	it('GET / : index.html sans jeton, no-store, CSP stricte (sans unsafe-eval) et en-têtes de sécurité', async () => {
		const c = await serviceFaux({}, { interface: await interfaceConstruite() });
		const r = await appeler(c.service.port, 'GET', '/');
		expect(r.statut).toBe(200);
		expect(r.texte).toContain('<div id="racine">');
		expect(r.entetes['content-type']).toBe('text/html; charset=utf-8');
		expect(r.entetes['cache-control']).toBe('no-store');
		const p = c.service.port;
		const csp = r.entetes['content-security-policy'];
		expect(csp).toBe(
			`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; ` +
				`connect-src 'self' ws://127.0.0.1:${p} ws://localhost:${p}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
		);
		expect(csp).not.toMatch(/unsafe-eval|wasm-unsafe-eval|\*|https?:(?!\/\/(127\.0\.0\.1|localhost))/u);
		expect(r.entetes['x-content-type-options']).toBe('nosniff');
		expect(r.entetes['referrer-policy']).toBe('no-referrer');
		expect(r.entetes['cross-origin-opener-policy']).toBe('same-origin');
		expect(r.entetes['cross-origin-resource-policy']).toBe('same-origin');
		expect(r.entetes['access-control-allow-origin']).toBeUndefined();
	});

	it('GET /assets/* : type MIME par extension, immutable', async () => {
		const c = await serviceFaux({}, { interface: await interfaceConstruite() });
		const js = await appeler(c.service.port, 'GET', '/assets/index-abc.js');
		expect(js.statut).toBe(200);
		expect(js.texte).toBe('console.log(1);');
		expect(js.entetes['content-type']).toBe('text/javascript; charset=utf-8');
		expect(js.entetes['cache-control']).toBe('public, max-age=31536000, immutable');
		expect((await appeler(c.service.port, 'GET', '/assets/index-abc.css')).entetes['content-type']).toBe('text/css; charset=utf-8');
	});

	it('application installable : manifeste, service worker, icônes ; jamais mis en cache longtemps', async () => {
		const c = await serviceFaux({}, { interface: await interfaceConstruite() });
		const port = c.service.port;
		const manifeste = await appeler(port, 'GET', '/manifest.webmanifest');
		expect(manifeste.statut).toBe(200);
		expect(manifeste.entetes['content-type']).toBe('application/manifest+json; charset=utf-8');
		expect(manifeste.corps).toEqual({ name: 'Mnemo' });
		const sw = await appeler(port, 'GET', '/sw.js');
		expect(sw.statut).toBe(200);
		expect(sw.entetes['content-type']).toBe('text/javascript; charset=utf-8');
		// un service worker se relit à chaque visite : une version corrigée remplace l'ancienne
		expect(sw.entetes['cache-control']).toBe('no-cache');
		expect(sw.entetes['content-security-policy']).toContain("script-src 'self'");
		const png = await appeler(port, 'GET', '/icones/icone-192.png');
		expect(png.statut).toBe(200);
		expect(png.entetes['content-type']).toBe('image/png');
		expect((await appeler(port, 'GET', '/icone.svg')).entetes['content-type']).toBe('image/svg+xml');
		for (const chemin of ['/icones/.cache.png', '/icones/../service.json', '/icones/absent.png', '/sw.js/x', '/manifest.webmanifest/'])
			expect((await appeler(port, 'GET', chemin)).statut, chemin).toBe(404);
	});

	it('chemins refusés (404) : remontée, segment caché, hors de assets/, absent ; l\'API reste derrière le jeton', async () => {
		const dist = await interfaceConstruite();
		await symlink(join(dist, 'service.json'), join(dist, 'assets', 'lien.js'));
		const c = await serviceFaux({}, { interface: dist });
		for (const chemin of ['/assets/../service.json', '/assets/%2e%2e/service.json', '/assets/..%2fservice.json', '/assets/.cache.js', '/service.json', '/index.html/x', '/assets/absent.js', '/assets/', '/assets/lien.js', '/assets/%00.js'])
			expect((await appeler(c.service.port, 'GET', chemin)).statut, chemin).toBe(404);
		expect((await appeler(c.service.port, 'GET', ROUTES.sante)).statut).toBe(401);
		expect((await appeler(c.service.port, 'POST', '/', { corps: {} })).statut).toBe(404);
	});

	it('mauvais Host → 403, même pour les fichiers', async () => {
		const c = await serviceFaux({}, { interface: await interfaceConstruite() });
		expect((await appeler(c.service.port, 'GET', '/', { host: `evil.example:${c.service.port}` })).statut).toBe(403);
		expect((await appeler(c.service.port, 'GET', '/assets/index-abc.js', { host: 'evil.example' })).statut).toBe(403);
	});

	it('interface non construite : / rend une page d\'avis', async () => {
		const c = await serviceFaux({}, { interface: join(await dossierTemporaire(), 'absent') });
		const r = await appeler(c.service.port, 'GET', '/');
		expect(r.statut).toBe(200);
		expect(r.entetes['content-type']).toBe('text/plain; charset=utf-8');
		expect(r.texte).toContain('Interface non construite : `pnpm construire`');
		expect((await appeler(c.service.port, 'GET', '/assets/index-abc.js')).statut).toBe(404);
	});

	it('dossierInterface : MNEMO_UI_DIST, sinon packages/ui/dist', () => {
		expect(dossierInterface({ MNEMO_UI_DIST: '/tmp/ailleurs' })).toBe('/tmp/ailleurs');
		expect(dossierInterface({}).replace(/\\/gu, '/')).toMatch(/packages\/ui\/dist$/u);
	});
});
