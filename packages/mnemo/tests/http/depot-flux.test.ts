import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fluxDuCorps } from '../../src/adaptateurs/http/serveur.ts';
import { join } from 'node:path';
import { tailleLisible } from '@mnemo/commun';
import { ROUTES } from '@mnemo/contrat';
import { describe, expect, it } from 'vitest';
import { hacheurOctets } from '../../src/domaine/empreinte.ts';
import { appeler, jusqua, serviceFaux } from '../aides/service-faux.ts';

const MO = 1024 * 1024;

/** Morceau n° `i` d'un corps généré à la volée (déterministe, jamais gardé). */
function morceau(i: number, taille = MO): Buffer {
	const b = Buffer.allocUnsafe(taille);
	for (let k = 0; k < taille; k += 4) b.writeUInt32LE((i * 2654435761 + k) >>> 0, k);
	return b;
}

type Envoi = { statut: number; corps: unknown };

/**
 * POST d'un dépôt en morceaux générés à la volée (`n` morceaux de 1 Mo), en respectant la contre-pression ; sans longueur
 * annoncée (corps en morceaux) sauf `longueur`. `couper` : la requête est détruite après ce nombre de morceaux.
 */
function deposerEnFlux(port: number, jeton: string, vers: string, n: number, o: { longueur?: number; couper?: number; hacheur?: ReturnType<typeof hacheurOctets>; origine?: string } = {}): Promise<Envoi | 'coupee'> {
	return new Promise((resoudre, rejeter) => {
		const req = request(
			{
				host: '127.0.0.1',
				port,
				path: `${ROUTES.depot}?vers=${encodeURIComponent(vers)}`,
				method: 'POST',
				agent: false,
				headers: {
					host: `127.0.0.1:${port}`,
					authorization: `Bearer ${jeton}`,
					'content-type': 'application/octet-stream',
					...(o.longueur === undefined ? {} : { 'content-length': String(o.longueur) }),
					...(o.origine === undefined ? {} : { origin: o.origine }),
				},
			},
			(res) => {
				const parts: Buffer[] = [];
				res.on('data', (m: Buffer) => parts.push(m));
				res.on('end', () => {
					const texte = Buffer.concat(parts).toString('utf8');
					let corps: unknown;
					try {
						corps = JSON.parse(texte);
					} catch {
						corps = undefined;
					}
					resoudre({ statut: res.statusCode ?? 0, corps });
				});
			},
		);
		req.on('error', (e) => (o.couper !== undefined ? resoudre('coupee') : rejeter(e)));
		let i = 0;
		const ecrire = (): void => {
			while (i < n) {
				if (o.couper !== undefined && i === o.couper) {
					req.destroy();
					resoudre('coupee');
					return;
				}
				const m = morceau(i++);
				o.hacheur?.ajouter(m);
				if (!req.write(m)) {
					req.once('drain', ecrire);
					return;
				}
			}
			req.end();
		};
		ecrire();
	});
}

/** Empreinte d'un fichier, lue en flux. */
async function empreinteFichier(chemin: string): Promise<string> {
	const h = hacheurOctets();
	for await (const m of createReadStream(chemin, { highWaterMark: MO })) h.ajouter(m as Buffer);
	return h.resultat();
}

/** Tout ce qui reste dans un dossier (fichiers temporaires cachés compris). */
const contenuDe = async (dossier: string): Promise<string[]> => (await readdir(dossier).catch(() => [] as string[])).sort();

describe('dépôt en flux (jusqu\'à TAILLE_MAX_DOCUMENT)', () => {
	it('300 Mo générés à la volée : écrits en flux, mémoire du processus bornée, fichier final identique', async () => {
		const c = await serviceFaux();
		const { port, jeton } = c.service;
		const hacheur = hacheurOctets();
		const memoire = () => {
			const m = process.memoryUsage();
			return m.heapUsed + m.arrayBuffers;
		};
		globalThis.gc?.();
		const avant = memoire();
		let pic = avant;
		const sonde = setInterval(() => (pic = Math.max(pic, memoire())), 5);
		const r = await deposerEnFlux(port, jeton, 'docs/gros.bin', 300, { hacheur });
		clearInterval(sonde);
		expect(r).toMatchObject({ statut: 201, corps: { chemin: 'docs/gros.bin' } });
		expect((await stat(join(c.racine, 'docs', 'gros.bin'))).size).toBe(300 * MO);
		expect(await empreinteFichier(join(c.racine, 'docs', 'gros.bin'))).toBe(hacheur.resultat());
		// le corps entier n'a jamais été en mémoire (mesure approximative : client et service sont dans ce processus)
		expect(pic - avant).toBeLessThan(120 * MO);
		// aucun temporaire laissé
		expect(await contenuDe(join(c.racine, 'docs'))).toEqual(['gros.bin']);
	}, 120_000);

	it('limite dépassée en cours d\'envoi (sans longueur annoncée) → 413 dès le dépassement, aucun fichier restant', async () => {
		const c = await serviceFaux({ depotMax: 2 * MO });
		const { port, jeton } = c.service;
		const r = await deposerEnFlux(port, jeton, 'docs/trop.bin', 5);
		expect(r).toEqual({ statut: 413, corps: { erreur: 'Document trop volumineux : « docs/trop.bin » (plus de 2 Mo).' } });
		expect(await jusqua(async () => (await contenuDe(join(c.racine, 'docs'))).length === 0, 2000)).toBe(true);
		// au plus juste : passe
		expect(await deposerEnFlux(port, jeton, 'docs/juste.bin', 2)).toMatchObject({ statut: 201 });
		expect(await contenuDe(join(c.racine, 'docs'))).toEqual(['juste.bin']);
	});

	it('longueur annoncée au-delà de 10 Go (limite par défaut) → 413 sans rien lire ni écrire', async () => {
		const c = await serviceFaux();
		const r = await appeler(c.service.port, 'POST', `${ROUTES.depot}?vers=docs/enorme.bin`, { jeton: c.service.jeton, corps: new Uint8Array(4), entetes: { 'content-length': String(11 * 1024 ** 3) } });
		expect(r.statut).toBe(413);
		expect(r.corps).toEqual({ erreur: 'Document trop volumineux : 11 Go (plus de 10 Go).' });
		expect(await contenuDe(join(c.racine, 'docs'))).toEqual([]);
	});

	it('envoi interrompu → le temporaire est retiré, aucun fichier restant ; le service répond toujours', async () => {
		const c = await serviceFaux();
		const { port, jeton } = c.service;
		expect(await deposerEnFlux(port, jeton, 'docs/coupe.bin', 20, { couper: 8 })).toBe('coupee');
		expect(await jusqua(async () => (await contenuDe(join(c.racine, 'docs'))).length === 0, 5000)).toBe(true);
		expect((await appeler(port, 'GET', ROUTES.sante, { jeton })).statut).toBe(200);
	});

	it('protections inchangées : jeton, Origin, chemin refusé, fichier existant jamais remplacé', async () => {
		const c = await serviceFaux();
		const { port, jeton } = c.service;
		// refusés avant toute lecture du corps (connexion fermée) : envoyés sans corps
		expect(await deposerEnFlux(port, 'faux', 'docs/a.bin', 0)).toMatchObject({ statut: 401 });
		expect(await deposerEnFlux(port, jeton, 'docs/a.bin', 0, { origine: 'http://evil.example' })).toMatchObject({ statut: 403 });
		expect(await contenuDe(c.racine)).not.toContain('docs');
		for (const vers of ['../dehors.bin', '_mnemo/x.bin', '.mnemo/x']) expect(await deposerEnFlux(port, jeton, vers, 1), vers).toMatchObject({ statut: 400 });
		expect(await deposerEnFlux(port, jeton, '.notes/x.bin', 1)).toMatchObject({ statut: 201 });
		// dossier EXISTANT au nom invisible : un dossier comme un autre ; ce que le dépôt CRÉE (fichier, dossier manquant) : nom invisible refusé
		await mkdir(join(c.racine, 'autres', '\u202eabc'), { recursive: true });
		expect(await deposerEnFlux(port, jeton, 'autres/\u202eabc/x.bin', 1)).toMatchObject({ statut: 201 });
		expect(await deposerEnFlux(port, jeton, 'autres/\u202etxt.exe', 1)).toMatchObject({ statut: 400 });
		expect(await deposerEnFlux(port, jeton, 'neufs/\u202edef/x.bin', 1)).toMatchObject({ statut: 400 });
		expect(await contenuDe(c.racine)).not.toContain('neufs');
		expect(await deposerEnFlux(port, jeton, 'docs//x.bin', 1)).toMatchObject({ statut: 400 });
		expect(await deposerEnFlux(port, jeton, 'docs/a.bin', 1)).toMatchObject({ statut: 201 });
		const avant = await empreinteFichier(join(c.racine, 'docs', 'a.bin'));
		expect(await deposerEnFlux(port, jeton, 'docs/a.bin', 3)).toMatchObject({ statut: 409 });
		expect(await empreinteFichier(join(c.racine, 'docs', 'a.bin'))).toBe(avant);
		expect(await contenuDe(join(c.racine, 'docs'))).toEqual(['a.bin']);
		expect(await contenuDe(c.racine)).not.toContain('dehors.bin');
		// dossier manquant au nom normal : créé par le dépôt
		expect(await deposerEnFlux(port, jeton, 'docs/neuf/a.bin', 1)).toMatchObject({ statut: 201 });
	});
});

/** Requête qui envoie `morceaux` à `intervalleMs` d'écart puis, si `finir`, termine ; rend la réponse ou « coupee ». */
function envoiLent(port: number, jeton: string, methode: string, chemin: string, morceaux: Buffer[], o: { intervalleMs: number; finir: boolean; longueur?: number }): Promise<Envoi | 'coupee'> {
	return new Promise((resoudre) => {
		const req = request(
			{
				host: '127.0.0.1',
				port,
				path: chemin,
				method: methode,
				agent: false,
				headers: {
					host: `127.0.0.1:${port}`,
					authorization: `Bearer ${jeton}`,
					'content-type': 'application/octet-stream',
					...(o.longueur === undefined ? {} : { 'content-length': String(o.longueur) }),
				},
			},
			(res) => {
				const parts: Buffer[] = [];
				res.on('data', (m: Buffer) => parts.push(m));
				res.on('end', () => resoudre({ statut: res.statusCode ?? 0, corps: JSON.parse(Buffer.concat(parts).toString('utf8') || 'null') }));
				res.on('error', () => resoudre('coupee'));
			},
		);
		req.on('error', () => resoudre('coupee'));
		let i = 0;
		const suivant = (): void => {
			if (i < morceaux.length) {
				req.write(morceaux[i++]);
				setTimeout(suivant, o.intervalleMs);
			} else if (o.finir) req.end();
		};
		suivant();
	});
}

describe('dépôt : vérification préalable, disque, délais, temporaires orphelins', () => {
	it('depotVerifier (sans corps) : libre, existe (409), chemin refusé (400), trop gros (413), place insuffisante (507) ; rien n\'est créé', async () => {
		const c = await serviceFaux({ depotMax: 2 ** 52 });
		const { port, jeton } = c.service;
		const verifier = (vers: string, taille?: number) =>
			appeler(port, 'GET', `${ROUTES.depotVerifier}?vers=${encodeURIComponent(vers)}${taille === undefined ? '' : `&taille=${taille}`}`, { jeton });
		expect(await verifier('docs/neuf/a.bin', 10)).toMatchObject({ statut: 200, corps: { chemin: 'docs/neuf/a.bin' } });
		expect(await contenuDe(c.racine)).not.toContain('docs');
		expect(await deposerEnFlux(port, jeton, 'docs/a.bin', 1)).toMatchObject({ statut: 201 });
		expect(await verifier('docs/a.bin', 10)).toMatchObject({ statut: 409, corps: { erreur: 'Le fichier « docs/a.bin » existe déjà : il n\'est jamais remplacé.' } });
		expect((await verifier('docs/.cache/x.bin')).statut).toBe(200);
		expect((await verifier('.mnemo/x.bin')).statut).toBe(400);
		expect((await verifier('../x.bin')).statut).toBe(400);
		expect((await verifier('docs/b.bin', -1)).statut).toBe(400);
		expect(await verifier('docs/b.bin', 2 ** 53)).toMatchObject({ statut: 400 });
		expect(await verifier('docs/b.bin', 2 ** 51)).toMatchObject({ statut: 507, corps: { erreur: expect.stringMatching(/^Place insuffisante sur le disque pour « docs\/b\.bin » : 2048 To à écrire, .+ libres\.$/u) } });
		const petit = await serviceFaux({ depotMax: MO });
		expect(await appeler(petit.service.port, 'GET', `${ROUTES.depotVerifier}?vers=docs/g.bin&taille=${2 * MO}`, { jeton: petit.service.jeton })).toMatchObject({
			statut: 413,
			corps: { erreur: 'Document trop volumineux : « docs/g.bin » (plus de 1 Mo).' },
		});
		expect((await appeler(port, 'GET', `${ROUTES.depotVerifier}?vers=docs/b.bin`, { jeton: 'faux' })).statut).toBe(401);
	});

	it('longueur annoncée au-delà de la place libre → 507 avant d\'écrire, rien ne reste', async () => {
		const c = await serviceFaux({ depotMax: 2 ** 52 });
		const r = await appeler(c.service.port, 'POST', `${ROUTES.depot}?vers=docs/enorme.bin`, { jeton: c.service.jeton, corps: new Uint8Array(4), entetes: { 'content-length': String(2 ** 51) } });
		expect(r.statut).toBe(507);
		expect(r.corps).toEqual({ erreur: expect.stringMatching(/^Place insuffisante sur le disque/u) });
		expect(await contenuDe(join(c.racine, 'docs'))).toEqual([]);
		expect(await contenuDe(join(c.racine, '.mnemo', 'depots'))).toEqual([]);
	});

	it('délais : un corps JSON trop lent → 408 (délai court) ; un dépôt lent mais actif passe ; un dépôt muet est coupé, temporaire retiré', async () => {
		const c = await serviceFaux({ delaiCorpsMs: 200, inactiviteDepotMs: 300 });
		const { port, jeton } = c.service;
		const json = await envoiLent(port, jeton, 'POST', ROUTES.deplacer, [Buffer.from('{"id":')], { intervalleMs: 50, finir: false, longueur: 100 });
		expect(json).toMatchObject({ statut: 408, corps: { erreur: 'Corps de la requête reçu trop lentement.' } });
		// six morceaux à 100 ms d'écart : plus long que le délai court, jamais muet plus longtemps que l'inactivité permise
		const lent = await envoiLent(port, jeton, 'POST', `${ROUTES.depot}?vers=docs/lent.bin`, [1, 2, 3, 4, 5, 6].map((i) => morceau(i, 1024)), { intervalleMs: 100, finir: true });
		expect(lent).toMatchObject({ statut: 201 });
		const muet = await envoiLent(port, jeton, 'POST', `${ROUTES.depot}?vers=docs/muet.bin`, [morceau(1, 1024)], { intervalleMs: 50, finir: false, longueur: 10 * 1024 });
		expect(muet).toBe('coupee');
		expect(await jusqua(async () => (await contenuDe(join(c.racine, '.mnemo', 'depots'))).length === 0, 2000)).toBe(true);
		expect(await contenuDe(join(c.racine, 'docs'))).toEqual(['lent.bin']);
	});

	it('au démarrage du service, les temporaires d\'un dépôt interrompu par un arrêt brutal sont retirés', async () => {
		let racine = '';
		const c = await serviceFaux(
			{},
			{
				pil: (p) => (racine = p.plugin.racine),
				avant: async () => {
					await mkdir(join(racine, '.mnemo', 'depots'), { recursive: true });
					await writeFile(join(racine, '.mnemo', 'depots', '0123456789abcdef01234567.depot'), 'reste d\'un dépôt interrompu');
				},
			},
		);
		expect(await contenuDe(join(c.racine, '.mnemo', 'depots'))).toEqual([]);
	});
});

describe('tailleLisible (contrat : la même pour le service et l\'interface)', () => {
	it('unités binaires françaises, une décimale au plus, virgule', () => {
		expect(tailleLisible(512)).toBe('512 octets');
		expect(tailleLisible(2500)).toBe('2,4 Ko');
		expect(tailleLisible(50 * 1024 * 1024)).toBe('50 Mo');
		expect(tailleLisible(10 * 1024 ** 3)).toBe('10 Go');
		expect(tailleLisible(1.5 * 1024 ** 3)).toBe('1,5 Go');
	});
});

describe('fluxDuCorps : le délai d\'inactivité ne court plus une fois le corps lu', () => {
	it('un travail plus long que le délai, après le corps, reçoit quand même sa réponse', async () => {
		const serveur = createServer((req, res) => {
			req.setTimeout(150, () => req.destroy(new Error('inactif')));
			void (async () => {
				let n = 0;
				for await (const m of fluxDuCorps(req)) n += m.byteLength;
				// une copie de repli lente, après la lecture du corps
				await new Promise((r) => setTimeout(r, 500));
				res.end(String(n));
			})();
		});
		await new Promise<void>((r) => serveur.listen(0, '127.0.0.1', r));
		try {
			const { port } = serveur.address() as AddressInfo;
			const reponse = await new Promise<string>((resoudre, rejeter) => {
				const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/', agent: false }, (res) => {
					let texte = '';
					res.on('data', (m: Buffer) => (texte += m.toString()));
					res.on('end', () => resoudre(texte));
				});
				req.on('error', rejeter);
				req.end(Buffer.alloc(1000));
			});
			expect(reponse).toBe('1000');
		} finally {
			serveur.close();
		}
	});
});
