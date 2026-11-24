import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { lstat, mkdir, readFile, readdir, readlink, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import JSZip from 'jszip';
import { Header } from 'tar';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { piecesPourPlateforme } from '../../src/infra/modeles/catalogue.ts';
import type { Piece } from '../../src/infra/modeles/catalogue.ts';
import { dossierModeles } from '../../src/infra/modeles/dossier.ts';
import { etatDesPieces, installerPiece } from '../../src/infra/modeles/installer.ts';
import { telechargerFichier } from '../../src/infra/modeles/telechargement.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

type Entree = { chemin: string; type?: 'File' | 'Directory' | 'SymbolicLink' | 'CharacterDevice' | 'Link'; contenu?: string; lien?: string; mode?: number };

/** Archive tar.gz fabriquée à la main : permet des entrées que `tar.c` refuserait (`../x`, lien absolu, périphérique). */
function archiveTar(entrees: Entree[]): Buffer {
	const blocs: Buffer[] = [];
	for (const e of entrees) {
		const contenu = Buffer.from(e.contenu ?? '');
		const type = e.type ?? 'File';
		const h = new Header({
			path: e.chemin,
			mode: e.mode ?? (type === 'Directory' ? 0o755 : 0o644),
			size: type === 'File' ? contenu.length : 0,
			type,
			linkpath: e.lien ?? '',
			mtime: new Date('2026-01-01T00:00:00Z'),
		});
		h.encode();
		blocs.push(h.block!);
		if (type === 'File' && contenu.length > 0) {
			blocs.push(contenu, Buffer.alloc((512 - (contenu.length % 512)) % 512));
		}
	}
	blocs.push(Buffer.alloc(1024));
	return gzipSync(Buffer.concat(blocs));
}

async function archiveZip(fichiers: Record<string, string>): Promise<Buffer> {
	const zip = new JSZip();
	for (const [nom, contenu] of Object.entries(fichiers)) zip.file(nom, contenu);
	return zip.generateAsync({ type: 'nodebuffer' });
}

const MODELE = Buffer.from('GGUF faux modèle '.repeat(5000));
const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>();
let serveur: Server;
let base: string;

function servir(chemin: string, corps: Buffer): string {
	routes.set(chemin, (_req, res) => {
		res.writeHead(200, { 'content-length': corps.length });
		res.end(corps);
	});
	return `${base}${chemin}`;
}

beforeAll(async () => {
	serveur = createServer((req, res) => {
		const route = routes.get(req.url ?? '');
		if (route === undefined) {
			res.writeHead(404);
			res.end();
			return;
		}
		route(req, res);
	});
	await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
	base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
	servir('/modele.gguf', MODELE);
	routes.set('/redirige/modele.gguf', (_req, res) => {
		res.writeHead(302, { location: '/modele.gguf' });
		res.end();
	});
	routes.set('/coupe/modele.gguf', (_req, res) => {
		res.writeHead(200, { 'content-length': MODELE.length });
		res.write(MODELE.subarray(0, 1000));
		setTimeout(() => res.socket?.destroy(), 20);
	});
	routes.set('/muet/modele.gguf', (_req, res) => {
		res.writeHead(200, { 'content-length': MODELE.length });
		res.write(MODELE.subarray(0, 1000));
		// plus rien : la connexion reste ouverte
	});
});

afterAll(async () => {
	serveur.closeAllConnections();
	await new Promise((ok) => serveur.close(ok));
});

/** Téléchargement de test : http local autorisé (la production n'accepte que https). */
const telechargerLocal = (url: string, vers: string) => telechargerFichier(url, vers, { httpsSeulement: false });

function pieceModele(adresse: string, empreinte = sha(MODELE)): Piece {
	return { nom: 'sens', libelle: 'sens de test', adresse, sha256: empreinte, archive: null, fichier: 'modele.gguf' };
}

async function contenuDe(dossier: string): Promise<string[]> {
	try {
		return (await readdir(dossier, { recursive: true })).map(String).sort();
	} catch {
		return [];
	}
}

describe('catalogue et dossier des modèles', () => {
	it('trois plateformes figées ; une autre → null', () => {
		const mac = piecesPourPlateforme('darwin', 'arm64')!;
		expect(mac.map((p) => p.nom)).toEqual(['moteur', 'sens', 'reranker']);
		expect(mac[0]).toMatchObject({
			adresse: 'https://github.com/ggml-org/llama.cpp/releases/download/b11671/llama-b11671-bin-macos-arm64.tar.gz',
			sha256: '0f9c093f77b9c194f2f097df6204d9f5f8758968815e7db0374e98b0485ef9df',
			archive: 'tar.gz',
			fichier: 'llama-server',
		});
		expect(mac[1]).toMatchObject({
			adresse: 'https://huggingface.co/ggml-org/bge-m3-Q8_0-GGUF/resolve/9eba04c5d75ba5a1595e45de734d36bef4e5cb98/bge-m3-q8_0.gguf',
			sha256: 'aa473d51f451a22f0fcf39ba3330c14bed38a385712b1113440f69df4047a173',
			archive: null,
			fichier: 'bge-m3-q8_0.gguf',
		});
		expect(mac[2]).toMatchObject({
			adresse: 'https://huggingface.co/gpustack/bge-reranker-v2-m3-GGUF/resolve/3093af03b1a635e67b084b1d8c03c5f5e020fd05/bge-reranker-v2-m3-Q8_0.gguf',
			sha256: 'a43c7c9b11a4c1517e5bf95151960e1621d1b72f7a493364b01e386cf1aaa1d3',
			archive: null,
			fichier: 'bge-reranker-v2-m3-Q8_0.gguf',
		});
		expect(piecesPourPlateforme('win32', 'x64')![0]).toMatchObject({
			adresse: 'https://github.com/ggml-org/llama.cpp/releases/download/b11671/llama-b11671-bin-win-cpu-x64.zip',
			sha256: 'a9a407979a351add66016ffb558a53de8b6655fed1eec362591d66ea671fec81',
			archive: 'zip',
			fichier: 'llama-server.exe',
		});
		expect(piecesPourPlateforme('linux', 'x64')![0]).toMatchObject({
			adresse: 'https://github.com/ggml-org/llama.cpp/releases/download/b11671/llama-b11671-bin-ubuntu-x64.tar.gz',
			sha256: 'e4120fe6742ce204891496deb95fa49453bdb400ed85807474dbe470f98d45bd',
			archive: 'tar.gz',
			fichier: 'llama-server',
		});
		expect(piecesPourPlateforme('linux', 'arm64')).toBeNull();
		expect(piecesPourPlateforme('darwin', 'x64')![0]).toMatchObject({
			adresse: 'https://github.com/ggml-org/llama.cpp/releases/download/b11671/llama-b11671-bin-macos-x64.tar.gz',
			sha256: 'd664a72c4c716e6fb0b90d4b2bf1c8dc2e6cff083cdbee26294fcc4f8d89366d',
			archive: 'tar.gz',
			fichier: 'llama-server',
		});
		expect(piecesPourPlateforme('win32', 'arm64')![0]).toMatchObject({
			adresse: 'https://github.com/ggml-org/llama.cpp/releases/download/b11671/llama-b11671-bin-win-cpu-arm64.zip',
			sha256: '80bae6519b3f8bd1e637789cbd3f65ce2112e60b50fb7f934fa1ef34e31f1b54',
			archive: 'zip',
			fichier: 'llama-server.exe',
		});
		expect(piecesPourPlateforme('freebsd', 'x64')).toBeNull();
	});

	it('dossierModeles : MNEMO_MODELES, puis le cache de chaque plateforme', () => {
		expect(dossierModeles({ MNEMO_MODELES: '/ailleurs/modeles' }, 'darwin', '/Users/a')).toBe('/ailleurs/modeles');
		expect(dossierModeles({}, 'darwin', '/Users/a')).toBe('/Users/a/Library/Caches/mnemo');
		expect(dossierModeles({ LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, 'win32', 'C:\\Users\\a')).toBe('C:\\Users\\a\\AppData\\Local\\mnemo\\cache');
		expect(dossierModeles({}, 'win32', 'C:\\Users\\a')).toBe('C:\\Users\\a\\AppData\\Local\\mnemo\\cache');
		expect(dossierModeles({ XDG_CACHE_HOME: '/home/a/.xdg' }, 'linux', '/home/a')).toBe('/home/a/.xdg/mnemo');
		expect(dossierModeles({}, 'linux', '/home/a')).toBe('/home/a/.cache/mnemo');
		// XDG relatif : ignoré (la spécification XDG l'exige absolu)
		expect(dossierModeles({ XDG_CACHE_HOME: 'relatif' }, 'linux', '/home/a')).toBe('/home/a/.cache/mnemo');
		expect(dossierModeles({ MNEMO_MODELES: '' }, 'linux', '/home/a')).toBe('/home/a/.cache/mnemo');
	});
});

describe('installerPiece', () => {
	it('empreinte juste : installé, marqueur écrit, aucun temporaire ; relancé : déjà installé sans téléchargement', async () => {
		const dossier = await dossierTemporaire();
		const piece = pieceModele(`${base}/modele.gguf`);
		expect((await etatDesPieces(dossier, [piece]))[0]!.installee).toBe(false);
		const resultat = await installerPiece(dossier, piece, { telecharger: telechargerLocal });
		expect(resultat).toEqual({ statut: 'telecharge' });
		const [etat] = await etatDesPieces(dossier, [piece]);
		expect(etat!.installee).toBe(true);
		expect(etat!.chemin).toBe(join(dossier, 'sens', piece.sha256.slice(0, 12), 'modele.gguf'));
		expect(await readFile(etat!.chemin)).toEqual(MODELE);
		expect((await readFile(join(dossier, 'sens', piece.sha256.slice(0, 12), '.empreinte'), 'utf8')).trim()).toBe(piece.sha256);
		expect(await contenuDe(join(dossier, 'sens'))).toEqual([piece.sha256.slice(0, 12), join(piece.sha256.slice(0, 12), '.empreinte'), join(piece.sha256.slice(0, 12), 'modele.gguf')].sort());

		let appels = 0;
		const encore = await installerPiece(dossier, piece, {
			telecharger: async () => {
				appels++;
			},
		});
		expect(encore).toEqual({ statut: 'deja' });
		expect(appels).toBe(0);
	});

	it('suit une redirection', async () => {
		const dossier = await dossierTemporaire();
		const piece = pieceModele(`${base}/redirige/modele.gguf`);
		await installerPiece(dossier, piece, { telecharger: telechargerLocal });
		expect((await etatDesPieces(dossier, [piece]))[0]!.installee).toBe(true);
	});

	it('fausse empreinte : refus, rien d\'installé, aucun temporaire', async () => {
		const dossier = await dossierTemporaire();
		const piece = pieceModele(`${base}/modele.gguf`, 'b'.repeat(64));
		await expect(installerPiece(dossier, piece, { telecharger: telechargerLocal })).rejects.toThrow(/Empreinte différente/u);
		expect((await etatDesPieces(dossier, [piece]))[0]!.installee).toBe(false);
		expect(await contenuDe(join(dossier, 'sens'))).toEqual([]);
	});

	it('coupure au milieu : refus, rien d\'installé, aucun temporaire', async () => {
		const dossier = await dossierTemporaire();
		const piece = pieceModele(`${base}/coupe/modele.gguf`);
		await expect(installerPiece(dossier, piece, { telecharger: telechargerLocal })).rejects.toThrow(/Téléchargement interrompu \(connexion coupée\)/u);
		expect(await contenuDe(join(dossier, 'sens'))).toEqual([]);
	});

	it('HTTP 404 : refus lisible', async () => {
		const dossier = await dossierTemporaire();
		await expect(installerPiece(dossier, pieceModele(`${base}/absent.gguf`), { telecharger: telechargerLocal })).rejects.toThrow(/HTTP 404/u);
		expect(await contenuDe(join(dossier, 'sens'))).toEqual([]);
	});

	it('serveur muet : abandon après le délai d\'inactivité, fichier partiel retiré', async () => {
		const dossier = await dossierTemporaire();
		const vers = join(dossier, 'partiel');
		await expect(telechargerFichier(`${base}/muet/modele.gguf`, vers, { httpsSeulement: false, delaiInactiviteMs: 200 })).rejects.toThrow(/aucune donnée/u);
		await expect(stat(vers)).rejects.toThrow();
	});

	it('par défaut, seul https est accepté', async () => {
		const dossier = await dossierTemporaire();
		await expect(telechargerFichier(`${base}/modele.gguf`, join(dossier, 'x'))).rejects.toThrow(/https/u);
		await expect(installerPiece(dossier, pieceModele(`${base}/modele.gguf`), {})).rejects.toThrow(/https/u);
		expect(await contenuDe(join(dossier, 'sens'))).toEqual([]);
	});

	it('redirection https → http : refusée ; accept-encoding: identity envoyé', async () => {
		const dossier = await dossierTemporaire();
		const demandes: { url: string; encodage: string | null }[] = [];
		const fauxFetch = (async (adresse: URL | RequestInfo, init?: RequestInit) => {
			demandes.push({ url: String(adresse), encodage: new Headers(init?.headers).get('accept-encoding') });
			return new Response(null, { status: 302, headers: { location: 'http://exemple.invalid/modele.gguf' } });
		}) as typeof fetch;
		await expect(telechargerFichier('https://exemple.invalid/depart.gguf', join(dossier, 'x'), { fetch: fauxFetch })).rejects.toThrow(/seul https/u);
		expect(demandes).toEqual([{ url: 'https://exemple.invalid/depart.gguf', encodage: 'identity' }]);
		await expect(stat(join(dossier, 'x'))).rejects.toThrow();
	});

	it('temporaires abandonnés (> 5 min) retirés au démarrage ; récents gardés', async () => {
		const dossier = await dossierTemporaire();
		const parent = join(dossier, 'sens');
		await mkdir(join(parent, '.tmp-vieux-dossier'), { recursive: true });
		await writeFile(join(parent, '.tmp-vieux-dossier', 'f'), 'x');
		await writeFile(join(parent, '.tmp-vieux'), 'x');
		await writeFile(join(parent, '.tmp-frais'), 'x');
		const autrefois = new Date(Date.now() - 10 * 60_000);
		await utimes(join(parent, '.tmp-vieux'), autrefois, autrefois);
		await utimes(join(parent, '.tmp-vieux-dossier'), autrefois, autrefois);
		const piece = pieceModele(`${base}/modele.gguf`);
		await installerPiece(dossier, piece, { telecharger: telechargerLocal });
		expect((await readdir(parent)).sort()).toEqual(['.tmp-frais', piece.sha256.slice(0, 12)]);
	});

	it('reste d\'installation inachevée à la place finale : remplacé', async () => {
		const dossier = await dossierTemporaire();
		const piece = pieceModele(`${base}/modele.gguf`);
		const final = join(dossier, 'sens', piece.sha256.slice(0, 12));
		await mkdir(final, { recursive: true });
		await writeFile(join(final, 'debris'), 'x');
		await installerPiece(dossier, piece, { telecharger: telechargerLocal });
		expect((await etatDesPieces(dossier, [piece]))[0]!.installee).toBe(true);
		expect((await readdir(final)).sort()).toEqual(['.empreinte', 'modele.gguf']);
		expect(await readdir(join(dossier, 'sens'))).toEqual([piece.sha256.slice(0, 12)]);
	});

	it('installation simultanée finie la première : gardée intacte, succès, aucun temporaire', async () => {
		const dossier = await dossierTemporaire();
		const piece = pieceModele(`${base}/modele.gguf`);
		const final = join(dossier, 'sens', piece.sha256.slice(0, 12));
		const concurrente = async (url: string, vers: string) => {
			await mkdir(final, { recursive: true });
			await writeFile(join(final, 'modele.gguf'), MODELE);
			await writeFile(join(final, 'temoin'), 'autre processus');
			await writeFile(join(final, '.empreinte'), `${piece.sha256}\n`);
			return telechargerLocal(url, vers);
		};
		expect(await installerPiece(dossier, piece, { telecharger: concurrente })).toEqual({ statut: 'telecharge' });
		expect(await readFile(join(final, 'temoin'), 'utf8')).toBe('autre processus');
		expect(await readdir(join(dossier, 'sens'))).toEqual([piece.sha256.slice(0, 12)]);
	});

	it('disque plein : message en français, aucun temporaire', async () => {
		const dossier = await dossierTemporaire();
		const plein = async () => {
			throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
		};
		await expect(installerPiece(dossier, pieceModele(`${base}/modele.gguf`), { telecharger: plein })).rejects.toThrow(/Disque plein/u);
		expect(await contenuDe(join(dossier, 'sens'))).toEqual([]);
	});

	it('marqueur absent ou fichier absent : pièce non installée', async () => {
		const dossier = await dossierTemporaire();
		const piece = pieceModele(`${base}/modele.gguf`);
		const ici = join(dossier, 'sens', piece.sha256.slice(0, 12));
		await mkdir(ici, { recursive: true });
		await writeFile(join(ici, 'modele.gguf'), MODELE);
		expect((await etatDesPieces(dossier, [piece]))[0]!.installee).toBe(false);
		await writeFile(join(ici, '.empreinte'), `${'c'.repeat(64)}\n`);
		expect((await etatDesPieces(dossier, [piece]))[0]!.installee).toBe(false);
		await writeFile(join(ici, '.empreinte'), `${piece.sha256}\n`);
		expect((await etatDesPieces(dossier, [piece]))[0]!.installee).toBe(true);
		// une installation incomplète laissée là est remplacée
		const autre = { ...piece, fichier: 'autre.gguf' };
		expect((await etatDesPieces(dossier, [autre]))[0]!.installee).toBe(false);
	});
});

describe('archives', () => {
	function pieceArchive(adresse: string, corps: Buffer, archive: 'tar.gz' | 'zip', fichier = 'llama-server'): Piece {
		return { nom: 'moteur', libelle: 'moteur de test', adresse, sha256: sha(corps), archive, fichier };
	}

	it('tar.gz : premier niveau retiré, liens relatifs internes gardés, binaire exécutable', async () => {
		const corps = archiveTar([
			{ chemin: 'llama-b1/', type: 'Directory' },
			{ chemin: 'llama-b1/llama-server', contenu: 'binaire', mode: 0o644 },
			{ chemin: 'llama-b1/libggml.0.27.0.dylib', contenu: 'lib' },
			{ chemin: 'llama-b1/libggml.0.dylib', type: 'SymbolicLink', lien: 'libggml.0.27.0.dylib' },
			{ chemin: 'llama-b1/libggml.dylib', type: 'SymbolicLink', lien: 'libggml.0.dylib' },
			{ chemin: 'llama-b1/sous/donnee.txt', contenu: 'd' },
			{ chemin: 'llama-b1/sous/serveur', type: 'SymbolicLink', lien: '../llama-server' },
		]);
		const piece = pieceArchive(servir('/bon.tar.gz', corps), corps, 'tar.gz');
		const dossier = await dossierTemporaire();
		await installerPiece(dossier, piece, { telecharger: telechargerLocal });
		const [etat] = await etatDesPieces(dossier, [piece]);
		expect(etat!.installee).toBe(true);
		const ici = join(dossier, 'moteur', piece.sha256.slice(0, 12));
		expect(etat!.chemin).toBe(join(ici, 'llama-server'));
		expect(await readFile(etat!.chemin, 'utf8')).toBe('binaire');
		expect(await readFile(join(ici, 'sous', 'donnee.txt'), 'utf8')).toBe('d');
		expect(await readlink(join(ici, 'libggml.0.dylib'))).toBe('libggml.0.27.0.dylib');
		expect(await readFile(join(ici, 'libggml.dylib'), 'utf8')).toBe('lib');
		expect(await readFile(join(ici, 'sous', 'serveur'), 'utf8')).toBe('binaire');
		if (process.platform !== 'win32') expect((await stat(etat!.chemin)).mode & 0o111).toBe(0o111);
		expect((await readdir(join(dossier, 'moteur'))).sort()).toEqual([piece.sha256.slice(0, 12)]);
	});

	const refus: [string, Entree[]][] = [
		['../x', [{ chemin: 'llama-b1/llama-server', contenu: 'b' }, { chemin: 'llama-b1/../../x', contenu: 'mal' }]],
		['chemin absolu', [{ chemin: 'llama-b1/llama-server', contenu: 'b' }, { chemin: '/tmp/mnemo-x', contenu: 'mal' }]],
		['lien absolu', [{ chemin: 'llama-b1/llama-server', contenu: 'b' }, { chemin: 'llama-b1/lien', type: 'SymbolicLink', lien: '/etc/passwd' }]],
		['lien sortant', [{ chemin: 'llama-b1/llama-server', contenu: 'b' }, { chemin: 'llama-b1/lien', type: 'SymbolicLink', lien: '../../x' }]],
		[
			'lien en chaîne qui sort',
			[
				{ chemin: 'llama-b1/llama-server', contenu: 'b' },
				{ chemin: 'llama-b1/sous/', type: 'Directory' },
				{ chemin: 'llama-b1/sous/haut', type: 'SymbolicLink', lien: '..' },
				{ chemin: 'llama-b1/sous/e', type: 'SymbolicLink', lien: 'haut/../x' },
			],
		],
		['périphérique', [{ chemin: 'llama-b1/llama-server', contenu: 'b' }, { chemin: 'llama-b1/dev', type: 'CharacterDevice' }]],
		['lien physique', [{ chemin: 'llama-b1/llama-server', contenu: 'b' }, { chemin: 'llama-b1/dur', type: 'Link', lien: 'llama-b1/llama-server' }]],
	];
	for (const [cas, entrees] of refus) {
		it(`tar.gz avec ${cas} : refus, rien d'écrit nulle part`, async () => {
			const corps = archiveTar(entrees);
			const piece = pieceArchive(servir(`/refus-${encodeURIComponent(cas)}.tar.gz`, corps), corps, 'tar.gz');
			const dossier = await dossierTemporaire();
			await expect(installerPiece(dossier, piece, { telecharger: telechargerLocal })).rejects.toThrow(/Archive refusée/u);
			expect((await etatDesPieces(dossier, [piece]))[0]!.installee).toBe(false);
			expect(await contenuDe(dossier)).toEqual(['moteur']);
			await expect(lstat('/tmp/mnemo-x')).rejects.toThrow();
		});
	}

	it('liens cycliques : `c0 -> .` et `c1 -> .` acceptés, `a -> b -> a` refusé, sans jamais boucler', async () => {
		const bon = archiveTar([
			{ chemin: 'llama-b1/llama-server', contenu: 'b' },
			{ chemin: 'llama-b1/c0', type: 'SymbolicLink', lien: '.' },
			{ chemin: 'llama-b1/c1', type: 'SymbolicLink', lien: '.' },
		]);
		const piece = pieceArchive(servir('/cycle-bon.tar.gz', bon), bon, 'tar.gz');
		const dossier = await dossierTemporaire();
		await installerPiece(dossier, piece, { telecharger: telechargerLocal });
		expect((await etatDesPieces(dossier, [piece]))[0]!.installee).toBe(true);

		const boucle = archiveTar([
			{ chemin: 'llama-b1/llama-server', contenu: 'b' },
			{ chemin: 'llama-b1/a', type: 'SymbolicLink', lien: 'b' },
			{ chemin: 'llama-b1/b', type: 'SymbolicLink', lien: 'a' },
		]);
		const autre = pieceArchive(servir('/cycle-mal.tar.gz', boucle), boucle, 'tar.gz');
		await expect(installerPiece(dossier, autre, { telecharger: telechargerLocal })).rejects.toThrow(/Archive refusée : lien symbolique cassé, en boucle/u);
	}, 5000);

	it('archive sans le fichier attendu : refus', async () => {
		const corps = archiveTar([{ chemin: 'llama-b1/autre', contenu: 'b' }]);
		const piece = pieceArchive(servir('/sans.tar.gz', corps), corps, 'tar.gz');
		const dossier = await dossierTemporaire();
		await expect(installerPiece(dossier, piece, { telecharger: telechargerLocal })).rejects.toThrow(/llama-server/u);
		expect(await contenuDe(dossier)).toEqual(['moteur']);
	});

	it('zip : premier niveau retiré, binaire exécutable', async () => {
		const corps = await archiveZip({ 'llama-b1/llama-server.exe': 'exe', 'llama-b1/ggml.dll': 'dll' });
		const piece = pieceArchive(servir('/bon.zip', corps), corps, 'zip', 'llama-server.exe');
		const dossier = await dossierTemporaire();
		await installerPiece(dossier, piece, { telecharger: telechargerLocal });
		const [etat] = await etatDesPieces(dossier, [piece]);
		expect(etat!.installee).toBe(true);
		expect(await readFile(etat!.chemin, 'utf8')).toBe('exe');
		expect(await readFile(join(dossier, 'moteur', piece.sha256.slice(0, 12), 'ggml.dll'), 'utf8')).toBe('dll');
		if (process.platform !== 'win32') expect((await stat(etat!.chemin)).mode & 0o111).toBe(0o111);
	});

	it('zip à plat (sans dossier commun) : rien n\'est retiré', async () => {
		const corps = await archiveZip({ 'llama-server.exe': 'exe', 'ggml.dll': 'dll' });
		const piece = pieceArchive(servir('/plat.zip', corps), corps, 'zip', 'llama-server.exe');
		const dossier = await dossierTemporaire();
		await installerPiece(dossier, piece, { telecharger: telechargerLocal });
		expect((await etatDesPieces(dossier, [piece]))[0]!.installee).toBe(true);
	});

	it('zip : lien relatif interne gardé, lien sortant refusé', async () => {
		const zipAvecLien = (cible: string) => {
			const zip = new JSZip();
			zip.file('llama-b1/llama-server', 'b', { unixPermissions: 0o100755 });
			zip.file('llama-b1/lien', cible, { unixPermissions: 0o120777 });
			return zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' });
		};
		const bon = await zipAvecLien('llama-server');
		const piece = pieceArchive(servir('/lien-bon.zip', bon), bon, 'zip');
		const dossier = await dossierTemporaire();
		await installerPiece(dossier, piece, { telecharger: telechargerLocal });
		expect(await readlink(join(dossier, 'moteur', piece.sha256.slice(0, 12), 'lien'))).toBe('llama-server');

		const mal = await zipAvecLien('../../x');
		const autre = pieceArchive(servir('/lien-mal.zip', mal), mal, 'zip');
		await expect(installerPiece(dossier, autre, { telecharger: telechargerLocal })).rejects.toThrow(/Archive refusée : lien symbolique sortant/u);
		expect((await readdir(join(dossier, 'moteur'))).sort()).toEqual([piece.sha256.slice(0, 12)]);
	});

	it('zip avec ../x : refus', async () => {
		const corps = await archiveZip({ 'llama-b1/llama-server.exe': 'exe', 'llama-b1/../../x': 'mal' });
		const piece = pieceArchive(servir('/mal.zip', corps), corps, 'zip', 'llama-server.exe');
		const dossier = await dossierTemporaire();
		await expect(installerPiece(dossier, piece, { telecharger: telechargerLocal })).rejects.toThrow(/Archive refusée/u);
		expect(await contenuDe(dossier)).toEqual(['moteur']);
	});
});

describe('installer depuis un dossier', () => {
	it('fichier de même nom à profondeur ≤ 2, empreinte juste : copié, rien téléchargé', async () => {
		const source = await dossierTemporaire();
		await mkdir(join(source, 'bge-m3'));
		await writeFile(join(source, 'bge-m3', 'modele.gguf'), MODELE);
		const dossier = await dossierTemporaire();
		const piece = pieceModele('https://exemple.invalid/chemin/modele.gguf');
		const resultat = await installerPiece(dossier, piece, {
			depuis: source,
			telecharger: async () => {
				throw new Error('ne doit pas télécharger');
			},
		});
		expect(resultat).toEqual({ statut: 'copie', depuis: join(source, 'bge-m3', 'modele.gguf') });
		expect((await etatDesPieces(dossier, [piece]))[0]!.installee).toBe(true);
		expect(await readFile(join(source, 'bge-m3', 'modele.gguf'))).toEqual(MODELE);
	});

	it('archive de même nom : dépliée comme une archive téléchargée', async () => {
		const corps = archiveTar([{ chemin: 'llama-b1/llama-server', contenu: 'binaire' }]);
		const source = await dossierTemporaire();
		await writeFile(join(source, 'moteur.tar.gz'), corps);
		const piece: Piece = { nom: 'moteur', libelle: 'moteur', adresse: 'https://exemple.invalid/moteur.tar.gz', sha256: sha(corps), archive: 'tar.gz', fichier: 'llama-server' };
		const dossier = await dossierTemporaire();
		expect((await installerPiece(dossier, piece, { depuis: source })).statut).toBe('copie');
		expect((await etatDesPieces(dossier, [piece]))[0]!.installee).toBe(true);
	});

	it('empreinte différente : écarté avec son chemin, puis téléchargé', async () => {
		const source = await dossierTemporaire();
		await writeFile(join(source, 'modele.gguf'), 'autre chose');
		const dossier = await dossierTemporaire();
		const piece = pieceModele(`${base}/modele.gguf`);
		const resultat = await installerPiece(dossier, piece, { depuis: source, telecharger: telechargerLocal });
		expect(resultat).toEqual({ statut: 'telecharge', ecartes: [join(source, 'modele.gguf')] });
		expect((await etatDesPieces(dossier, [piece]))[0]!.installee).toBe(true);
		expect(await contenuDe(join(dossier, 'sens'))).toHaveLength(3);
	});

	it('trop profond (3 niveaux) ou absent : téléchargé', async () => {
		const source = await dossierTemporaire();
		await mkdir(join(source, 'a', 'b', 'c'), { recursive: true });
		await writeFile(join(source, 'a', 'b', 'c', 'modele.gguf'), MODELE);
		const dossier = await dossierTemporaire();
		const piece = pieceModele(`${base}/modele.gguf`);
		expect(await installerPiece(dossier, piece, { depuis: source, telecharger: telechargerLocal })).toEqual({ statut: 'telecharge' });
	});
});
