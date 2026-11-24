import { ENTETE_REMPLACEMENT } from '@mnemo/contrat';
import { describe, expect, it, vi } from 'vitest';
import { creerApi, ErreurApi, estAbandon } from '../../src/client/api.ts';

const JETON = 'c'.repeat(64);

function reponse(statut: number, corps: unknown): Response {
	return new Response(JSON.stringify(corps), { status: statut, headers: { 'Content-Type': 'application/json' } });
}

describe('api', () => {
	it("envoie l'en-tête Authorization et les paramètres", async () => {
		const f = vi.fn(async () => reponse(200, { ok: 1 }));
		const api = creerApi({ base: 'http://127.0.0.1:4100', jeton: JETON, fetch: f as unknown as typeof fetch, surJetonRefuse: () => {} });
		expect(await api.lire('/api/memoire/fiche', { chemin: 'projets/a b.md' })).toEqual({ ok: 1 });
		const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('http://127.0.0.1:4100/api/memoire/fiche?chemin=projets%2Fa+b.md');
		expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${JETON}`);
		// pas de clé de remplacement sans la demander
		expect(new Headers(init.headers).get(ENTETE_REMPLACEMENT)).toBeNull();
	});

	it('lire avec `remplacement` : clé `<onglet>:<consommateur>`, même onglet pour tout le client ; 409 → abandon (jamais une erreur)', async () => {
		let statut = 200;
		const f = vi.fn(async () => (statut === 200 ? reponse(200, { ok: 1 }) : reponse(409, { erreur: 'Recherche remplacée par une plus récente.' })));
		const api = creerApi({ base: 'http://127.0.0.1:4100', jeton: JETON, fetch: f as unknown as typeof fetch, surJetonRefuse: () => {} });
		await api.lire('/api/recherche', { q: 'a' }, { remplacement: 'palette' });
		await api.lire('/api/recherche', { q: 'b' }, { remplacement: 'autre' });
		const cle = (i: number) => new Headers((f.mock.calls[i] as unknown as [string, RequestInit])[1].headers).get(ENTETE_REMPLACEMENT);
		expect(cle(0)).toMatch(/^[\w-]{1,64}:palette$/);
		expect(cle(1)).toBe(cle(0)!.replace(/:palette$/, ':autre'));
		statut = 409;
		const e = await api.lire('/api/recherche', { q: 'c' }, { remplacement: 'palette' }).catch((x: unknown) => x);
		expect(estAbandon(e)).toBe(true);
		// sans clé, un 409 reste une erreur du service
		const sans = await api.lire('/api/recherche', { q: 'd' }).catch((x: unknown) => x);
		expect(estAbandon(sans)).toBe(false);
		expect(sans).toBeInstanceOf(ErreurApi);
	});

	it('lire : signal transmis à fetch ; abandon rendu tel quel (pas « Service injoignable »)', async () => {
		const f = vi.fn(async (_url: string, init: RequestInit) => {
			if (init.signal?.aborted) throw new DOMException('abandon', 'AbortError');
			return reponse(200, { ok: 1 });
		});
		const api = creerApi({ base: '', jeton: JETON, fetch: f as unknown as typeof fetch, surJetonRefuse: () => {} });
		const controleur = new AbortController();
		await api.lire('/api/recherche', { q: 'x' }, { signal: controleur.signal });
		expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBe(controleur.signal);
		controleur.abort();
		await expect(api.lire('/api/recherche', { q: 'x' }, { signal: controleur.signal })).rejects.toMatchObject({ name: 'AbortError' });
	});

	it('envoyer : POST JSON', async () => {
		const f = vi.fn(async () => reponse(200, { statut: 'ok' }));
		const api = creerApi({ base: '', jeton: JETON, fetch: f as unknown as typeof fetch, surJetonRefuse: () => {} });
		await api.envoyer('/api/sessions/x/pause', { a: 1 });
		const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('/api/sessions/x/pause');
		expect(init.method).toBe('POST');
		expect(init.body).toBe('{"a":1}');
		expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
	});

	it('remplacer : PUT JSON, avec le jeton', async () => {
		const f = vi.fn(async () => reponse(200, { champs: [] }));
		const api = creerApi({ base: '', jeton: JETON, fetch: f as unknown as typeof fetch, surJetonRefuse: () => {} });
		await api.remplacer('/api/reglages', { valeurs: { 'service.port': 4800 } });
		const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('/api/reglages');
		expect(init.method).toBe('PUT');
		expect(init.body).toBe('{"valeurs":{"service.port":4800}}');
		expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
		expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${JETON}`);
	});

	it('supprimer : DELETE, paramètres dans l’adresse', async () => {
		const f = vi.fn(async () => reponse(200, { ecartes: [] }));
		const api = creerApi({ base: '', jeton: JETON, fetch: f as unknown as typeof fetch, surJetonRefuse: () => {} });
		expect(await api.supprimer('/api/sessions/x/ecartes', { id: 'a.md#^f-1' })).toEqual({ ecartes: [] });
		const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('/api/sessions/x/ecartes?id=a.md%23%5Ef-1');
		expect(init.method).toBe('DELETE');
		expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${JETON}`);
	});

	it('401 → surJetonRefuse et ErreurApi, sans le jeton dans le message', async () => {
		const surJetonRefuse = vi.fn();
		const api = creerApi({ base: '', jeton: JETON, fetch: (async () => reponse(401, { erreur: 'jeton refusé' })) as unknown as typeof fetch, surJetonRefuse });
		const e = await api.lire('/api/sessions').catch((x: unknown) => x);
		expect(e).toBeInstanceOf(ErreurApi);
		expect((e as ErreurApi).statut).toBe(401);
		expect((e as ErreurApi).message).not.toContain(JETON);
		expect(surJetonRefuse).toHaveBeenCalledOnce();
	});

	it("{ erreur } → message de l'ErreurApi", async () => {
		const api = creerApi({ base: '', jeton: JETON, fetch: (async () => reponse(409, { erreur: 'La fiche a changé.' })) as unknown as typeof fetch, surJetonRefuse: () => {} });
		const e = (await api.envoyer('/api/memoire/brut', {}).catch((x: unknown) => x)) as ErreurApi;
		expect(e.statut).toBe(409);
		expect(e.message).toBe('La fiche a changé.');
	});

	/** Fausse requête d'envoi : garde ce qui est posé et envoyé ; `repondre` simule la progression puis la réponse. */
	function fausseRequete() {
		const r = {
			ouverte: [] as string[],
			entetes: {} as Record<string, string>,
			envoye: null as unknown,
			status: 0,
			responseText: '',
			annulee: false,
			upload: { onprogress: null as ((e: ProgressEvent) => void) | null },
			onload: null as (() => void) | null,
			onerror: null as (() => void) | null,
			open: (methode: string, url: string) => void r.ouverte.push(methode, url),
			setRequestHeader: (nom: string, valeur: string) => void (r.entetes[nom] = valeur),
			send: (corps: unknown) => void (r.envoye = corps),
			abort: () => void (r.annulee = true),
			repondre(statut: number, corps: unknown, etapes: number[] = []) {
				for (const loaded of etapes) r.upload.onprogress?.({ loaded, total: 4, lengthComputable: true } as ProgressEvent);
				r.status = statut;
				r.responseText = JSON.stringify(corps);
				r.onload?.();
			},
		};
		return r;
	}

	it('déposer : le Blob lui-même pour corps (lu en flux par le navigateur), destination en paramètre, progression suivie', async () => {
		const requete = fausseRequete();
		const f = vi.fn(async () => reponse(200, { chemin: 'erp' }));
		const api = creerApi({ base: '', jeton: JETON, fetch: f as unknown as typeof fetch, surJetonRefuse: () => {}, requeteEnvoi: () => requete as never });
		const fichier = new Blob(['%PDF']);
		const progression: [number, number][] = [];
		const envoi = api.deposer('erp', fichier, (envoyes, total) => progression.push([envoyes, total]));
		await vi.waitFor(() => expect(requete.ouverte).toHaveLength(2));
		expect(requete.ouverte).toEqual(['POST', '/api/depot?vers=erp']);
		expect(requete.entetes).toEqual({ Authorization: `Bearer ${JETON}`, 'Content-Type': 'application/octet-stream' });
		// jamais un ArrayBuffer du fichier : le Blob tel quel
		expect(requete.envoye).toBe(fichier);
		requete.repondre(201, { chemin: 'erp/cdc.pdf' }, [1, 4]);
		expect(await envoi).toEqual({ chemin: 'erp/cdc.pdf' });
		expect(progression).toEqual([[1, 4], [4, 4]]);
		// vérifié d'abord, sans corps
		expect(f).toHaveBeenCalledOnce();
		expect(f.mock.calls[0]).toMatchObject(['/api/depot/verifier?vers=erp&taille=4', { method: 'GET' }]);
	});

	it('déposer : refus de la vérification préalable (409, 400, 507) → message exact du service, rien n\'est envoyé', async () => {
		const requete = fausseRequete();
		for (const [statut, erreur] of [
			[409, 'Le fichier « erp/cdc.pdf » existe déjà : il n\'est jamais remplacé.'],
			[400, 'Chemin de document refusé : « erp/.x » (dossier ou fichier caché).'],
			[507, 'Place insuffisante sur le disque pour « erp/cdc.pdf » : 3 Go à écrire, 1 Go libres.'],
		] as const) {
			const api = creerApi({ base: '', jeton: JETON, fetch: (async () => reponse(statut, { erreur })) as unknown as typeof fetch, surJetonRefuse: () => {}, requeteEnvoi: () => requete as never });
			expect(await api.deposer('erp/cdc.pdf', new Blob(['x'])).catch((x: unknown) => x)).toMatchObject({ statut, message: erreur });
		}
		expect(requete.ouverte).toEqual([]);
		expect(requete.envoye).toBeNull();
	});

	it('déposer : annulé par son signal → requête abandonnée, rendu comme un abandon', async () => {
		const requete = fausseRequete();
		const api = creerApi({ base: '', jeton: JETON, fetch: (async () => reponse(200, { chemin: 'erp/g.bin' })) as unknown as typeof fetch, surJetonRefuse: () => {}, requeteEnvoi: () => requete as never });
		const annulation = new AbortController();
		const envoi = api.deposer('erp/g.bin', new Blob(['x']), undefined, annulation.signal).catch((x: unknown) => x);
		await vi.waitFor(() => expect(requete.envoye).not.toBeNull());
		annulation.abort();
		const e = await envoi;
		expect(estAbandon(e)).toBe(true);
		expect(requete.annulee).toBe(true);
	});

	it('déposer : 413 → ErreurApi avec le message exact du service ; connexion coupée → « Service injoignable » ; 401 signalé', async () => {
		const surJetonRefuse = vi.fn();
		let requete = fausseRequete();
		const libre = vi.fn(async () => reponse(200, { chemin: 'erp/g.bin' }));
		const api = creerApi({ base: '', jeton: JETON, fetch: libre as unknown as typeof fetch, surJetonRefuse, requeteEnvoi: () => requete as never });
		const envoye = async () => vi.waitFor(() => expect(requete.envoye).not.toBeNull());
		const trop = api.deposer('erp/g.bin', new Blob(['x'])).catch((x: unknown) => x);
		await envoye();
		requete.repondre(413, { erreur: 'Document trop volumineux : « erp/g.bin » (plus de 10 Go).' });
		expect(await trop).toMatchObject({ statut: 413, message: 'Document trop volumineux : « erp/g.bin » (plus de 10 Go).' });
		requete = fausseRequete();
		const coupe = api.deposer('erp/g.bin', new Blob(['x'])).catch((x: unknown) => x);
		await envoye();
		requete.onerror?.();
		expect(await coupe).toMatchObject({ statut: 0, message: 'Service injoignable.' });
		requete = fausseRequete();
		const refus = api.deposer('erp/g.bin', new Blob(['x'])).catch((x: unknown) => x);
		await envoye();
		requete.repondre(401, { erreur: 'Jeton absent ou invalide.' });
		expect(await refus).toBeInstanceOf(ErreurApi);
		expect(surJetonRefuse).toHaveBeenCalledOnce();
	});
});
