import { beforeEach, describe, expect, it, vi } from 'vitest';
import { creerClientReel } from '../../src/client/creer-client.ts';
import { FauxWebSocket, FauxWebSocketType } from '../aides/faux-websocket.ts';
import { laisserPasser, minuterieSimulee } from '../aides/installer.ts';

const JETON = 'd'.repeat(64);

function client(statut: number) {
	const valeurs = new Map([['mnemo.jeton', JETON]]);
	const stockage = { removeItem: vi.fn((k: string) => void valeurs.delete(k)) };
	const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ erreur: 'jeton refusé' }), { status: statut }));
	const minuterie = minuterieSimulee();
	const c = creerClientReel({ jeton: JETON, origine: 'http://127.0.0.1:4100', fetch: fetch as unknown as typeof globalThis.fetch, WebSocket: FauxWebSocketType, stockage, minuterie });
	return { c, valeurs, fetch, minuterie };
}

beforeEach(() => FauxWebSocket.reinitialiser());

describe('creerClientReel', () => {
	it('WebSocket sur l’origine, jeton en sous-protocole, jamais dans l’adresse', () => {
		client(200);
		expect(FauxWebSocket.derniere().url).toBe('ws://127.0.0.1:4100/ws');
		expect(FauxWebSocket.derniere().protocoles).toEqual(['mnemo', `mnemo.jeton.${JETON}`]);
	});

	it('API : jeton en Authorization', async () => {
		const { c, fetch } = client(200);
		await c.api.lire('/api/sessions').catch(() => {});
		expect(new Headers(fetch.mock.calls[0]![1]!.headers).get('Authorization')).toBe(`Bearer ${JETON}`);
	});

	it('401 de l’API → jeton effacé du stockage, abonnés prévenus, abonné tardif prévenu tout de suite', async () => {
		const { c, valeurs } = client(401);
		const avant = vi.fn();
		c.surJetonRefuse(avant);
		await c.api.lire('/api/sessions').catch(() => {});
		expect(avant).toHaveBeenCalledOnce();
		expect(valeurs.has('mnemo.jeton')).toBe(false);
		const tardif = vi.fn();
		c.surJetonRefuse(tardif);
		expect(tardif).toHaveBeenCalledOnce();
	});

	it('jeton_refuse de la connexion → jeton effacé, abonnés prévenus', async () => {
		const { c, valeurs, minuterie } = client(401);
		const f = vi.fn();
		c.surJetonRefuse(f);
		FauxWebSocket.derniere().fermerDepuisServeur();
		await laisserPasser();
		minuterie.avancer();
		FauxWebSocket.derniere().fermerDepuisServeur();
		await laisserPasser();
		await laisserPasser();
		expect(c.connexion.etat()).toBe('jeton_refuse');
		expect(f).toHaveBeenCalledOnce();
		expect(valeurs.has('mnemo.jeton')).toBe(false);
	});
});
