/**
 * Fichiers de l'interface construite (`packages/ui/dist`, ou `MNEMO_UI_DIST`) : `GET /` → `index.html`, `GET /assets/*`,
 * `GET /icones/*`, et à la racine seulement le manifeste, le service worker et l'icône de l'application installable.
 * Servis sans jeton (ces fichiers ne contiennent aucun secret), mais après la vérification du `Host` (faite par le
 * serveur). Chemin normalisé : remontée, segment caché, lien symbolique ou fichier hors de ces listes → 404.
 */
import { realpath, readFile, stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Types MIME par extension (le reste : `application/octet-stream`). */
const TYPES: Readonly<Record<string, string>> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.webmanifest': 'application/manifest+json; charset=utf-8',
	'.map': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.wasm': 'application/wasm',
	'.txt': 'text/plain; charset=utf-8',
};

const AVIS_NON_CONSTRUITE = 'Interface non construite : `pnpm construire` (à la racine du dépôt Mnemo), puis recharger cette page.\n';

/** Dossier de l'interface construite : `MNEMO_UI_DIST`, sinon `packages/ui/dist` (depuis ce fichier). */
export function dossierInterface(env: Record<string, string | undefined> = process.env): string {
	const choisi = env.MNEMO_UI_DIST;
	if (choisi !== undefined && choisi !== '') return choisi;
	return fileURLToPath(new URL('../../../../ui/dist', import.meta.url));
}

/**
 * En-têtes des fichiers de l'interface. CSP : scripts du service seulement (ni en ligne, ni `eval` : ni React, ni xterm, ni
 * three.js n'en ont besoin ; le service worker et le morceau du graphe sont des fichiers du service) ; styles du service et
 * en ligne (`'unsafe-inline'` : xterm écrit son thème et ses dimensions dans des éléments `<style>`, React pose des attributs
 * `style`) ; images du service et `data:` (xterm, three.js) ; connexions au service et à son WebSocket (les deux noms
 * acceptés par `Host`) ; ni plugin, ni `<base>`, ni cadre, ni formulaire vers ailleurs. COOP : aucune autre page ne garde de
 * référence à la fenêtre ; CORP : aucune autre origine n'inclut ces fichiers.
 */
export function entetesInterface(port: number): Record<string, string> {
	return {
		'content-security-policy': [
			"default-src 'self'",
			"script-src 'self'",
			"style-src 'self' 'unsafe-inline'",
			"img-src 'self' data:",
			`connect-src 'self' ws://127.0.0.1:${port} ws://localhost:${port}`,
			"object-src 'none'",
			"base-uri 'none'",
			"frame-ancestors 'none'",
			"form-action 'self'",
		].join('; '),
		'x-content-type-options': 'nosniff',
		'referrer-policy': 'no-referrer',
		'cross-origin-opener-policy': 'same-origin',
		'cross-origin-resource-policy': 'same-origin',
	};
}

/** Fichiers de l'application installable servis à la racine (rien d'autre de `dist/` n'y est visible). */
const FICHIERS_RACINE = new Set(['manifest.webmanifest', 'sw.js', 'icone.svg']);
/** Dossiers servis ; `assets/` porte des noms à empreinte (cache immuable), les autres non (revalidés). */
const DOSSIERS = new Map([
	['assets', 'public, max-age=31536000, immutable'],
	['icones', 'no-cache'],
]);

/** Segments décodés de `/assets/…` s'ils sont sûrs (ni vides, ni cachés, ni `..`, ni séparateur ou NUL), sinon null. */
function segmentsSurs(chemin: string): string[] | null {
	const segments: string[] = [];
	for (const brut of chemin.split('/')) {
		let segment: string;
		try {
			segment = decodeURIComponent(brut);
		} catch {
			return null;
		}
		if (segment === '' || segment.startsWith('.') || /[\\/\0:]/u.test(segment)) return null;
		segments.push(segment);
	}
	return segments;
}

/** Fichier réel sous `dossier` (liens résolus, toujours dedans, fichier ordinaire), ou null. */
async function fichierDans(dossier: string, segments: string[]): Promise<string | null> {
	try {
		const base = await realpath(dossier);
		const reel = await realpath(join(dossier, ...segments));
		if (reel !== join(base, ...segments) || !reel.startsWith(base + sep)) return null;
		return (await stat(reel)).isFile() ? reel : null;
	} catch {
		return null;
	}
}

/**
 * Sert un fichier de l'interface pour ce chemin (déjà décodé par l'URL, sans requête) ; rend faux si le chemin n'en est pas
 * un (404 à rendre par l'appelant).
 */
export async function servirInterface(res: ServerResponse, o: { dossier: string; port: number; methode: string; chemin: string }): Promise<boolean> {
	if (o.methode !== 'GET' && o.methode !== 'HEAD') return false;
	const envoyer = (corps: Buffer, type: string, cache: string): true => {
		res.writeHead(200, { ...entetesInterface(o.port), 'content-type': type, 'content-length': corps.byteLength, 'cache-control': cache });
		res.end(o.methode === 'HEAD' ? undefined : corps);
		return true;
	};
	if (o.chemin === '/') {
		const index = await fichierDans(o.dossier, ['index.html']);
		if (index === null) return envoyer(Buffer.from(AVIS_NON_CONSTRUITE), 'text/plain; charset=utf-8', 'no-store');
		return envoyer(await readFile(index), TYPES['.html']!, 'no-store');
	}
	const type = (fichier: string) => TYPES[extname(fichier).toLowerCase()] ?? 'application/octet-stream';
	const nom = o.chemin.slice(1);
	if (FICHIERS_RACINE.has(nom)) {
		const fichier = await fichierDans(o.dossier, [nom]);
		// manifeste et service worker relus à chaque visite : une version corrigée remplace l'ancienne
		return fichier === null ? false : envoyer(await readFile(fichier), type(fichier), 'no-cache');
	}
	const barre = nom.indexOf('/');
	const cache = barre > 0 ? DOSSIERS.get(nom.slice(0, barre)) : undefined;
	if (cache === undefined) return false;
	const segments = segmentsSurs(nom.slice(barre + 1));
	if (segments === null) return false;
	const fichier = await fichierDans(join(o.dossier, nom.slice(0, barre)), segments);
	if (fichier === null) return false;
	return envoyer(await readFile(fichier), type(fichier), cache);
}
