import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { demarrerService, ErreurServiceOccupe } from '../../src/adaptateurs/http/serveur.ts';
import { ENTETES_SECURITE, hoteValide, jetonDuWebSocket, jetonValide, origineValide } from '../../src/adaptateurs/http/securite.ts';
import { appeler, serviceFaux } from '../aides/service-faux.ts';

/** Un jeton quelconque (pas celui du service). */
const nouveauJeton = (): string => randomBytes(32).toString('hex');

/** Ouverture d'un WebSocket : `ouvert`, ou le statut HTTP du refus (0 : connexion coupée sans réponse). */
function ouvrirWs(
	port: number,
	jeton: string,
	options: { origine?: string; host?: string; protocoles?: string[] } = {},
): Promise<{ ouvert: true; ws: WebSocket } | { ouvert: false; statut: number }> {
	return new Promise((resoudre) => {
		const adresse = `ws://127.0.0.1:${port}/ws${options.protocoles === undefined ? `?jeton=${jeton}` : ''}`;
		const ws = new WebSocket(adresse, options.protocoles ?? [], {
			...(options.origine === undefined ? {} : { origin: options.origine }),
			...(options.host === undefined ? {} : { headers: { host: options.host } }),
		});
		ws.once('open', () => resoudre({ ouvert: true, ws }));
		ws.once('unexpected-response', (_req, res) => {
			resoudre({ ouvert: false, statut: res.statusCode ?? 0 });
			ws.terminate();
		});
		ws.once('error', () => resoudre({ ouvert: false, statut: 0 }));
	});
}

describe('securite (fonctions)', () => {
	it('jetonValide : égalité exacte seulement (longueur différente, absent, vide → faux)', () => {
		const jeton = nouveauJeton();
		expect(jetonValide(jeton, jeton)).toBe(true);
		expect(jetonValide(`${jeton.slice(0, -1)}${jeton.endsWith('0') ? '1' : '0'}`, jeton)).toBe(false);
		expect(jetonValide(jeton.slice(0, 10), jeton)).toBe(false);
		expect(jetonValide(`${jeton}00`, jeton)).toBe(false);
		expect(jetonValide(undefined, jeton)).toBe(false);
		expect(jetonValide(null, jeton)).toBe(false);
		expect(jetonValide('', jeton)).toBe(false);
	});

	it('hoteValide : 127.0.0.1:<port> ou localhost:<port>, rien d’autre', () => {
		expect(hoteValide('127.0.0.1:4100', 4100)).toBe(true);
		expect(hoteValide('localhost:4100', 4100)).toBe(true);
		expect(hoteValide('LOCALHOST:4100', 4100)).toBe(true);
		expect(hoteValide('127.0.0.1:4101', 4100)).toBe(false);
		expect(hoteValide('127.0.0.1', 4100)).toBe(false);
		expect(hoteValide('evil.example:4100', 4100)).toBe(false);
		expect(hoteValide('localhost.evil.example:4100', 4100)).toBe(false);
		expect(hoteValide('[::1]:4100', 4100)).toBe(false);
		expect(hoteValide(undefined, 4100)).toBe(false);
	});

	it('origineValide : absente, ou exactement http:// + le Host reçu (127.0.0.1 et localhost ne se mélangent pas)', () => {
		expect(origineValide(undefined, '127.0.0.1:4100')).toBe(true);
		expect(origineValide('http://127.0.0.1:4100', '127.0.0.1:4100')).toBe(true);
		expect(origineValide('http://localhost:4100', 'localhost:4100')).toBe(true);
		expect(origineValide('http://LOCALHOST:4100', 'localhost:4100')).toBe(true);
		expect(origineValide('http://localhost:4100', '127.0.0.1:4100')).toBe(false);
		expect(origineValide('http://127.0.0.1:4100', 'localhost:4100')).toBe(false);
		expect(origineValide('https://127.0.0.1:4100', '127.0.0.1:4100')).toBe(false);
		expect(origineValide('http://127.0.0.1:4101', '127.0.0.1:4100')).toBe(false);
		expect(origineValide('http://evil.example', '127.0.0.1:4100')).toBe(false);
		expect(origineValide('null', '127.0.0.1:4100')).toBe(false);
		expect(origineValide('', '127.0.0.1:4100')).toBe(false);
	});

	it('jetonDuWebSocket : sous-protocole mnemo.jeton.<jeton> d’abord, sinon ?jeton=', () => {
		expect(jetonDuWebSocket('mnemo, mnemo.jeton.abc', null)).toBe('abc');
		expect(jetonDuWebSocket('mnemo.jeton.abc,mnemo', 'autre')).toBe('abc');
		expect(jetonDuWebSocket('mnemo', 'def')).toBe('def');
		expect(jetonDuWebSocket(undefined, null)).toBeNull();
	});

	it('en-têtes de sécurité : CSP default-src self, nosniff, no-referrer', () => {
		expect(ENTETES_SECURITE).toMatchObject({
			'content-security-policy': "default-src 'self'",
			'x-content-type-options': 'nosniff',
			'referrer-policy': 'no-referrer',
		});
	});
});

describe('service : écoute et accès', () => {
	it('écoute sur 127.0.0.1 seulement (adresse vérifiée ; ::1 refusé)', async () => {
		const { service } = await serviceFaux();
		expect(service.adresse).toBe('127.0.0.1');
		const reponse = await appeler(service.port, 'GET', '/api/sante', { jeton: service.jeton });
		expect(reponse.statut).toBe(200);
		const ipv6 = await new Promise<string>((resoudre) => {
			const s = connect({ host: '::1', port: service.port });
			s.once('connect', () => {
				s.destroy();
				resoudre('connecte');
			});
			s.once('error', (e: NodeJS.ErrnoException) => resoudre(e.code ?? 'erreur'));
		});
		expect(ipv6).not.toBe('connecte');
	});

	it('sans jeton ou mauvais jeton → 401 { erreur } (le jeton n’apparaît jamais dans la réponse)', async () => {
		const { service } = await serviceFaux();
		const sans = await appeler(service.port, 'GET', '/api/sessions');
		expect(sans.statut).toBe(401);
		expect(sans.corps).toEqual({ erreur: expect.any(String) });
		const faux = await appeler(service.port, 'GET', '/api/sessions', { jeton: nouveauJeton() });
		expect(faux.statut).toBe(401);
		expect(faux.texte).not.toContain(service.jeton);
		// ?jeton= n'est accepté que pour le WebSocket
		const parRequete = await appeler(service.port, 'GET', `/api/sessions?jeton=${service.jeton}`);
		expect(parRequete.statut).toBe(401);
		expect(parRequete.texte).not.toContain(service.jeton);
		expect((await appeler(service.port, 'GET', '/api/sessions', { jeton: service.jeton })).statut).toBe(200);
	});

	it('mauvais Host → 403 ; localhost:<port> accepté', async () => {
		const { service } = await serviceFaux();
		const jeton = service.jeton;
		expect((await appeler(service.port, 'GET', '/api/sante', { jeton, host: 'evil.example' })).statut).toBe(403);
		expect((await appeler(service.port, 'GET', '/api/sante', { jeton, host: `evil.example:${service.port}` })).statut).toBe(403);
		expect((await appeler(service.port, 'GET', '/api/sante', { jeton, host: `127.0.0.1:${service.port + 1}` })).statut).toBe(403);
		expect((await appeler(service.port, 'GET', '/api/sante', { jeton, host: `localhost:${service.port}` })).statut).toBe(200);
	});

	it('Origin étrangère → 403 sur toute requête /api/*, même avec le jeton ; absente ou du service : acceptée', async () => {
		const { service } = await serviceFaux();
		const jeton = service.jeton;
		for (const origin of ['http://evil.example', `http://127.0.0.1:${service.port + 1}`, 'null']) {
			const r = await appeler(service.port, 'GET', '/api/sessions', { jeton, entetes: { origin } });
			expect(r.statut).toBe(403);
			expect(r.corps).toEqual({ erreur: expect.any(String) });
			expect((await appeler(service.port, 'POST', '/api/sessions', { jeton, entetes: { origin }, corps: { dossier: 'alpha' } })).statut).toBe(403);
		}
		expect((await appeler(service.port, 'GET', '/api/sessions', { jeton })).statut).toBe(200);
		expect((await appeler(service.port, 'GET', '/api/sessions', { jeton, entetes: { origin: `http://127.0.0.1:${service.port}` } })).statut).toBe(200);
		expect((await appeler(service.port, 'GET', '/api/sessions', { jeton, host: `localhost:${service.port}`, entetes: { origin: `http://localhost:${service.port}` } })).statut).toBe(200);
		// Origin exactement celle du Host : localhost vers 127.0.0.1 refusée
		expect((await appeler(service.port, 'GET', '/api/sessions', { jeton, entetes: { origin: `http://localhost:${service.port}` } })).statut).toBe(403);
	});

	it('chaque réponse porte CSP, nosniff, no-referrer, et aucune en-tête CORS', async () => {
		const { service } = await serviceFaux();
		for (const r of [
			await appeler(service.port, 'GET', '/api/sante', { jeton: service.jeton }),
			await appeler(service.port, 'GET', '/api/sante'),
			await appeler(service.port, 'GET', '/api/sante', { jeton: service.jeton, host: 'evil.example' }),
			await appeler(service.port, 'GET', '/api/inconnue', { jeton: service.jeton }),
			await appeler(service.port, 'OPTIONS', '/api/sessions', { entetes: { origin: 'http://evil.example', 'access-control-request-method': 'POST' } }),
		]) {
			expect(r.entetes['content-security-policy']).toBe("default-src 'self'");
			expect(r.entetes['x-content-type-options']).toBe('nosniff');
			expect(r.entetes['referrer-policy']).toBe('no-referrer');
			expect(Object.keys(r.entetes).filter((k) => k.startsWith('access-control-'))).toEqual([]);
		}
	});

	it('WebSocket : jeton exigé, Origin étranger refusé, Origin absent ou du service accepté, Host vérifié', async () => {
		const { service } = await serviceFaux();
		const { port, jeton } = service;
		expect(await ouvrirWs(port, nouveauJeton())).toEqual({ ouvert: false, statut: 401 });
		expect(await ouvrirWs(port, jeton, { origine: 'http://evil.example' })).toEqual({ ouvert: false, statut: 403 });
		expect(await ouvrirWs(port, jeton, { origine: `http://127.0.0.1:${port + 1}` })).toEqual({ ouvert: false, statut: 403 });
		expect(await ouvrirWs(port, jeton, { host: 'evil.example' })).toEqual({ ouvert: false, statut: 403 });
		expect(await ouvrirWs(port, jeton, { origine: `http://localhost:${port}` })).toEqual({ ouvert: false, statut: 403 });
		for (const options of [{}, { origine: `http://127.0.0.1:${port}` }, { origine: `http://localhost:${port}`, host: `localhost:${port}` }]) {
			const r = await ouvrirWs(port, jeton, options);
			expect(r.ouvert).toBe(true);
			if (r.ouvert) r.ws.terminate();
		}
	});

	it('WebSocket de l’interface : jeton en sous-protocole (jamais dans l’adresse) ; le service choisit « mnemo » et ne renvoie pas le jeton', async () => {
		const { service } = await serviceFaux();
		const { port, jeton } = service;
		const origine = `http://127.0.0.1:${port}`;
		const r = await ouvrirWs(port, jeton, { origine, protocoles: ['mnemo', `mnemo.jeton.${jeton}`] });
		expect(r.ouvert).toBe(true);
		if (r.ouvert) {
			expect(r.ws.protocol).toBe('mnemo');
			r.ws.terminate();
		}
		expect(await ouvrirWs(port, jeton, { origine, protocoles: ['mnemo', `mnemo.jeton.${nouveauJeton()}`] })).toEqual({ ouvert: false, statut: 401 });
		expect(await ouvrirWs(port, jeton, { origine, protocoles: ['mnemo'] })).toEqual({ ouvert: false, statut: 401 });
	});

	it('corps trop gros → 413 (JSON > 1 Mo, annoncé ou envoyé en morceaux ; dépôt au-delà de sa limite)', async () => {
		const { service } = await serviceFaux({ depotMax: 1024 * 1024 });
		const { port, jeton } = service;
		const gros = { genre: 'fait', texte: 'x'.repeat(1024 * 1024 + 10) };
		expect((await appeler(port, 'POST', '/api/proposer', { jeton, corps: gros })).statut).toBe(413);
		// sans longueur annoncée (morceaux) : coupé à la lecture
		const morceaux = await appeler(port, 'POST', '/api/proposer', { jeton, corps: gros, entetes: { 'content-length': '' } });
		expect(morceaux.statut).toBe(413);
		// dépôt : longueur annoncée au-delà de la limite (abaissée ici à 1 Mo), refusée avant lecture
		const depot = await appeler(port, 'POST', '/api/depot?vers=docs/a.txt', { jeton, corps: new Uint8Array(1024 * 1024 + 1) });
		expect(depot.statut).toBe(413);
		// taille annoncée démesurée : refusée sans rien lire
		const demesure = await appeler(port, 'POST', '/api/depot?vers=docs/b.txt', { jeton, corps: new Uint8Array(10), entetes: { 'content-length': String(500 * 1024 * 1024) } });
		expect(demesure.statut).toBe(413);
		expect(demesure.corps).toEqual({ erreur: 'Document trop volumineux : 500 Mo (plus de 1 Mo).' });
		expect((await appeler(port, 'GET', '/api/sante', { jeton })).statut).toBe(200);
	});

	it('service.json : { pid, port, jeton, demarre }, droits 0600 ; retiré à l’arrêt', async () => {
		const { service, racine } = await serviceFaux();
		const chemin = join(racine, '.mnemo', 'service.json');
		const lu = JSON.parse(await readFile(chemin, 'utf8')) as Record<string, unknown>;
		expect(lu).toEqual({ pid: process.pid, port: service.port, jeton: service.jeton, demarre: expect.any(Number) });
		if (process.platform !== 'win32') expect((await stat(chemin)).mode & 0o777).toBe(0o600);
		await service.arreter();
		await expect(stat(chemin)).rejects.toThrow();
	});

	it('jeton stable : un second démarrage du même dossier reprend le jeton de .mnemo/jeton', async () => {
		const c = await serviceFaux();
		const premier = c.service.jeton;
		expect((await readFile(join(c.racine, '.mnemo', 'jeton'), 'utf8')).trim()).toBe(premier);
		await c.service.arreter();
		const second = await demarrerService({ racine: c.racine, dep: c.dep, pil: c.pil, interface: join(c.racine, 'interface-absente'), dossierClaude: join(c.racine, 'claude-absent'), modeles: c.modeles });
		try {
			expect(second.jeton).toBe(premier);
			expect((await appeler(second.port, 'GET', '/api/sante', { jeton: premier })).statut).toBe(200);
		} finally {
			await second.arreter();
		}
	});

	it('un seul service par dossier : un second démarrage sur la même racine est refusé', async () => {
		const c = await serviceFaux();
		await expect(demarrerService({ racine: c.racine, dep: c.dep, pil: c.pil })).rejects.toBeInstanceOf(ErreurServiceOccupe);
		// le premier n'a pas été dérangé
		expect((await appeler(c.service.port, 'GET', '/api/sante', { jeton: c.service.jeton })).statut).toBe(200);
	});

	it('verrou perdu (remplacé par un autre service) : journalisé, le service s’arrête de lui-même sans toucher au verrou de l’autre', async () => {
		const lignes: string[] = [];
		const c = await serviceFaux({ sondageMs: 100, journal: (m) => lignes.push(m) });
		const chemin = join(c.racine, '.mnemo', 'service.verrou');
		const autre = `${JSON.stringify({ pid: 1, demarrageMachineMs: 0, lanceMs: 0, jeton: 'autre' })}\n`;
		await writeFile(chemin, autre);
		await expect(Promise.race([c.service.perdu.then(() => 'perdu'), new Promise((r) => setTimeout(() => r('délai'), 5000))])).resolves.toBe('perdu');
		await c.service.arreter();
		expect(lignes.join('\n')).toMatch(/verrou/u);
		await expect(stat(join(c.racine, '.mnemo', 'service.json'))).rejects.toThrow();
		expect(await readFile(chemin, 'utf8')).toBe(autre);
	});

	it('journal du service : jamais le jeton (requête refusée, erreur)', async () => {
		const lignes: string[] = [];
		const { service } = await serviceFaux({ journal: (m) => lignes.push(m) });
		await appeler(service.port, 'GET', `/api/sessions?jeton=${service.jeton}`);
		await appeler(service.port, 'GET', '/api/sessions', { jeton: `${service.jeton}0` });
		await appeler(service.port, 'POST', '/api/proposer', { jeton: service.jeton, corps: Buffer.from('{pas du json') as unknown as Uint8Array, entetes: { 'content-type': 'application/json' } });
		await service.arreter();
		expect(lignes.join('\n')).not.toContain(service.jeton);
	});
});
