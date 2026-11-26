// Client WebSocket contre un serveur `ws` local : sous-protocoles (jeton), aucun `Origin`, messages analysés, reconnexion
// après une coupure, arrêt définitif à `fermer`.
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PREFIXE_JETON_WS, PROTOCOLE_WS, ROUTES, type MessageServeur } from '@mnemo/contrat';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ouvrirClientWs } from '../../src/infra/client-ws.ts';

const JETON = 'b'.repeat(64);

async function jusqua(condition: () => boolean, delaiMs = 3000): Promise<boolean> {
	const fin = Date.now() + delaiMs;
	while (Date.now() < fin) {
		if (condition()) return true;
		await new Promise((r) => setTimeout(r, 5));
	}
	return condition();
}

const fermetures: (() => void)[] = [];
afterEach(() => {
	for (const f of fermetures.splice(0)) f();
});

async function serveur(): Promise<{ port: number; connexions: { ws: WebSocket; req: IncomingMessage }[] }> {
	const wss = new WebSocketServer({ host: '127.0.0.1', port: 0, handleProtocols: (p) => (p.has(PROTOCOLE_WS) ? PROTOCOLE_WS : false) });
	await new Promise<void>((r) => wss.once('listening', () => r()));
	const connexions: { ws: WebSocket; req: IncomingMessage }[] = [];
	wss.on('connection', (ws, req) => void connexions.push({ ws, req }));
	fermetures.push(() => {
		for (const c of wss.clients) c.terminate();
		wss.close();
	});
	return { port: (wss.address() as AddressInfo).port, connexions };
}

describe('client WebSocket', () => {
	it('jeton en sous-protocole, aucun Origin ; messages remis ; reconnexion après une coupure ; plus rien après fermer', async () => {
		const { port, connexions } = await serveur();
		const recus: MessageServeur[] = [];
		const etats: boolean[] = [];
		const client = ouvrirClientWs({ port, jeton: JETON, surMessage: (m) => void recus.push(m), surEtat: (e) => void etats.push(e), delaisMs: [20] });
		fermetures.push(() => client.fermer());
		expect(await jusqua(() => connexions.length === 1 && client.ouvert())).toBe(true);
		const { req, ws } = connexions[0]!;
		expect(req.url).toBe(ROUTES.ws);
		expect(req.headers['sec-websocket-protocol']).toBe(`${PROTOCOLE_WS},${PREFIXE_JETON_WS}${JETON}`);
		expect(req.headers.origin).toBeUndefined();
		expect(req.headers.host).toBe(`127.0.0.1:${port}`);

		ws.send(JSON.stringify({ type: 'sessions', sessions: [] }));
		ws.send('pas du JSON');
		expect(await jusqua(() => recus.length === 1)).toBe(true);
		expect(recus).toEqual([{ type: 'sessions', sessions: [] }]);

		ws.terminate();
		expect(await jusqua(() => connexions.length === 2 && client.ouvert())).toBe(true);
		expect(etats).toEqual([true, false, true]);

		client.fermer();
		connexions[1]!.ws.terminate();
		await new Promise((r) => setTimeout(r, 100));
		expect(connexions).toHaveLength(2);
		expect(client.ouvert()).toBe(false);
	});

	it('service absent : réessaie jusqu’à ce qu’il réponde', async () => {
		// un port libre, sur lequel rien n'écoute encore
		const libre = new WebSocketServer({ host: '127.0.0.1', port: 0 });
		await new Promise<void>((r) => libre.once('listening', () => r()));
		const port = (libre.address() as AddressInfo).port;
		await new Promise<void>((r) => libre.close(() => r()));
		const client = ouvrirClientWs({ port, jeton: JETON, surMessage: () => {}, delaisMs: [10, 20, 40] });
		fermetures.push(() => client.fermer());
		await new Promise((r) => setTimeout(r, 100));
		expect(client.ouvert()).toBe(false);
		const wss = new WebSocketServer({ host: '127.0.0.1', port, handleProtocols: () => PROTOCOLE_WS });
		fermetures.push(() => {
			for (const c of wss.clients) c.terminate();
			wss.close();
		});
		expect(await jusqua(() => client.ouvert())).toBe(true);
	});
});
