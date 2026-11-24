import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { suiteDeLaDemande } from '../../src/adaptateurs/cli/arreter.ts';
import { requeteLocaleDetaillee } from '../../src/infra/modeles/http-local.ts';

describe('mnemo arreter : suite donnée à la réponse de POST /api/arret', () => {
	it('202 : accepté ; 404 (version antérieure) ou connexion refusée : SIGTERM', () => {
		expect(suiteDeLaDemande({ statut: 202, corps: { ok: true } })).toBe('accepte');
		expect(suiteDeLaDemande({ statut: 404, corps: { erreur: 'Route inconnue.' } })).toBe('signal');
		expect(suiteDeLaDemande({ echec: 'refusee' })).toBe('signal');
	});

	it('délai dépassé ou réponse coupée : la demande a pu être reçue, attente de l’arrêt sans signal', () => {
		for (const echec of ['delai', 'interrompue', 'trop-grosse'] as const) expect(suiteDeLaDemande({ echec }), echec).toBe('attendre');
	});

	it('autre statut : refus lisible qui le nomme, aucun signal', () => {
		expect(suiteDeLaDemande({ statut: 401, corps: { erreur: 'Jeton absent ou invalide.' } })).toEqual({ refus: expect.stringContaining('401') });
	});

	it('requeteLocaleDetaillee : un port où personne n’écoute rend « refusee »', async () => {
		const serveur = createServer();
		await new Promise<void>((r) => serveur.listen(0, '127.0.0.1', r));
		const { port } = serveur.address() as AddressInfo;
		await new Promise<void>((r) => serveur.close(() => r()));
		expect(await requeteLocaleDetaillee(port, '/api/arret', { cle: null, finMs: Date.now() + 2000, corps: {} })).toEqual({ echec: 'refusee' });
	});
});
