// Recherche de version : jamais de vrai réseau (requête simulée).
import { describe, expect, it } from 'vitest';
import { ADRESSE_DERNIERE_VERSION } from '../../src/domaine/version.ts';
import { derniereVersionPubliee, type Telecharger } from '../../src/infra/versions.ts';

const PAGE = 'https://github.com/GauthierCoste/mnemo/releases/tag/v1.6.0';

describe('dernière version publiée', () => {
	it('requête anonyme à l’API des versions ; réponse lue', async () => {
		const appels: [string, RequestInit][] = [];
		const telecharger: Telecharger = async (url, init) => {
			appels.push([url, init]);
			return new Response(JSON.stringify({ tag_name: 'v1.6.0', html_url: PAGE }), { status: 200 });
		};
		expect(await derniereVersionPubliee(telecharger)).toEqual({ version: '1.6.0', url: PAGE });
		expect(appels).toHaveLength(1);
		expect(appels[0]![0]).toBe(ADRESSE_DERNIERE_VERSION);
		expect(appels[0]![1]).toMatchObject({ headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Mnemo' }, credentials: 'omit', redirect: 'error' });
		expect(appels[0]![1].body).toBeUndefined();
	});

	it('échec silencieux : réseau, statut, JSON illisible', async () => {
		expect(await derniereVersionPubliee(async () => Promise.reject(new Error('hors ligne')))).toBeNull();
		expect(await derniereVersionPubliee(async () => new Response('{}', { status: 404 }))).toBeNull();
		expect(await derniereVersionPubliee(async () => new Response('pas du json', { status: 200 }))).toBeNull();
		expect(await derniereVersionPubliee(async (_u, init) => new Promise((_r, rejeter) => init.signal?.addEventListener('abort', () => rejeter(new Error('délai')))), 20)).toBeNull();
	});
});
