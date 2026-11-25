import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { ROUTES } from '@mnemo/contrat';
import type { EtatModelesVue, MessageServeur, SessionVue } from '@mnemo/contrat';
import type { Session } from '../../src/domaine/session.ts';
import { appeler, etatModelesFaux, jusqua, serviceFaux } from '../aides/service-faux.ts';
import type { ContexteService } from '../aides/service-faux.ts';

const UUID = '11111111-2222-4333-8444-555555555555';
const routeSession = (id: string) => ROUTES.sessionModeles.replace(':id', id);

function sessionFixe(id: string, surcharge: Partial<Session> = {}): Session {
	return {
		id,
		profil: 'travail',
		dossier: 'alpha',
		position: 'projets/alpha',
		projet: 'alpha',
		objectif: 'Objectif',
		etat: 'attend',
		creeeMs: 1000,
		majMs: 1000,
		arretAttendu: null,
		bilanDemandeMs: null,
		commitDebut: null,
		branche: null,
		pid: null,
		...surcharge,
	};
}

const clients: WebSocket[] = [];
afterEach(() => {
	while (clients.length > 0) clients.pop()!.terminate();
});

/** Client WebSocket qui garde ses messages ; prêt une fois l'accueil (`sessions`) reçu. */
async function ecouter(c: ContexteService): Promise<MessageServeur[]> {
	const recus: MessageServeur[] = [];
	const ws = new WebSocket(`ws://127.0.0.1:${c.service.port}${ROUTES.ws}?jeton=${c.service.jeton}`);
	clients.push(ws);
	ws.on('message', (brut) => recus.push(JSON.parse(String(brut)) as MessageServeur));
	await new Promise((r, e) => {
		ws.once('open', r);
		ws.once('error', e);
	});
	expect(await jusqua(() => recus.some((m) => m.type === 'sessions'), 2000)).toBe(true);
	return recus;
}

const modelesRecus = (recus: MessageServeur[]) => recus.flatMap((m) => (m.type === 'modeles' ? [m.modeles] : []));
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

function api(c: ContexteService) {
	const { port, jeton } = c.service;
	return {
		get: (route: string) => appeler(port, 'GET', route, { jeton }),
		post: (route: string) => appeler(port, 'POST', route, { jeton, corps: {} }),
		put: (route: string, corps: unknown) => appeler(port, 'PUT', route, { jeton, corps }),
	};
}

describe('routes : modèles de la machine', () => {
	it('GET modeles : la vue entière de l’état', async () => {
		const c = await serviceFaux();
		const r = await api(c).get(ROUTES.modeles);
		expect(r.statut).toBe(200);
		expect(r.corps).toEqual(etatModelesFaux() satisfies EtatModelesVue);
		c.modeles.vue = { ...c.modeles.vue, gardien: 'pret', sens: 'pret', reranker: 'exclu', niveau: 'sens' };
		c.modeles.vue.activites = [{ operation: 'vectorisation', session: null, dossier: c.racine, depuisMs: 5, avancement: { faits: 120, total: null } }];
		expect((await api(c).get(ROUTES.modeles)).corps).toEqual(c.modeles.vue);
	});

	it('POST demarrer, POST arreter : le geste est fait, la nouvelle vue rendue', async () => {
		const c = await serviceFaux();
		const demarrage = await api(c).post(ROUTES.modelesDemarrer);
		expect(demarrage.statut).toBe(200);
		expect(demarrage.corps).toEqual(c.modeles.vue);
		const arret = await api(c).post(ROUTES.modelesArreter);
		expect(arret.statut).toBe(200);
		expect(arret.corps).toEqual(c.modeles.vue);
		expect(c.modeles.gestes).toEqual(['demarrer', 'arreter']);
	});

	it('PUT modeles/niveau : niveau valide changé et rendu ; invalide → 400 en français, rien changé', async () => {
		const c = await serviceFaux();
		const r = await api(c).put(ROUTES.modelesNiveau, { niveau: 'sens' });
		expect(r.statut).toBe(200);
		expect((r.corps as EtatModelesVue).niveau).toBe('sens');
		for (const corps of [{ niveau: 'aucun' }, { niveau: null }, {}, { niveau: 2 }, []]) {
			const refus = await api(c).put(ROUTES.modelesNiveau, corps);
			expect(refus.statut, JSON.stringify(corps)).toBe(400);
			expect((refus.corps as { erreur: string }).erreur).toContain('« niveau »');
		}
		expect(c.modeles.gestes).toEqual(['niveau sens']);
	});

	it('jeton exigé', async () => {
		const c = await serviceFaux();
		expect((await appeler(c.service.port, 'GET', ROUTES.modeles, {})).statut).toBe(401);
		expect((await appeler(c.service.port, 'PUT', ROUTES.modelesNiveau, { corps: { niveau: 'sens' } })).statut).toBe(401);
		expect(c.modeles.gestes).toEqual([]);
	});
});

describe('routes : niveau des modèles d’une session', () => {
	it('PUT : niveau propre gardé, rendu dans la vue, diffusé ; null : la session suit la machine', async () => {
		const c = await serviceFaux();
		await c.etat.creer(sessionFixe(UUID));
		const recus = await ecouter(c);
		const r = await api(c).put(routeSession(UUID), { niveau: 'coupes' });
		expect(r.statut).toBe(200);
		expect((r.corps as { session: SessionVue }).session.niveauModeles).toBe('coupes');
		expect((await c.etat.lire(UUID))?.niveauModeles).toBe('coupes');
		const diffusee = () => recus.find((m): m is Extract<MessageServeur, { type: 'session' }> => m.type === 'session' && m.session.id === UUID && m.session.niveauModeles === 'coupes');
		expect(await jusqua(() => diffusee() !== undefined, 2000)).toBe(true);
		const retour = await api(c).put(routeSession(UUID), { niveau: null });
		expect((retour.corps as { session: SessionVue }).session.niveauModeles).toBeNull();
		expect((await c.etat.lire(UUID))?.niveauModeles).toBeUndefined();
		expect((await api(c).get(ROUTES.session.replace(':id', UUID))).corps).toMatchObject({ session: { niveauModeles: null } });
	});

	it('refus : niveau invalide 400, session inconnue 404, session terminée 409', async () => {
		const c = await serviceFaux();
		await c.etat.creer(sessionFixe(UUID));
		for (const corps of [{ niveau: 'tous' }, {}, { niveau: 1 }]) expect((await api(c).put(routeSession(UUID), corps)).statut, JSON.stringify(corps)).toBe(400);
		expect((await api(c).put(routeSession('22222222-2222-4333-8444-555555555555'), { niveau: 'sens' })).statut).toBe(404);
		expect((await api(c).put(routeSession('pas-un-uuid'), { niveau: 'sens' })).statut).toBe(404);
		await c.etat.modifier(UUID, { etat: 'terminee' });
		expect((await api(c).put(routeSession(UUID), { niveau: 'sens' })).statut).toBe(409);
		expect((await c.etat.lire(UUID))?.niveauModeles).toBeUndefined();
	});
});

describe('diffusion de l’état des modèles', () => {
	it('un changement signalé par la surveillance part aux clients ; un signal sans changement, rien', async () => {
		const c = await serviceFaux({ sondageModelesMs: 60_000 });
		const recus = await ecouter(c);
		// la première lecture (référence) est faite : un signal sans changement ne diffuse rien
		await attendre(100);
		c.modeles.signaler();
		await attendre(200);
		expect(modelesRecus(recus)).toEqual([]);
		c.modeles.vue = { ...c.modeles.vue, activites: [{ operation: 'recherche', session: UUID, dossier: c.racine, depuisMs: 1, avancement: null }] };
		c.modeles.signaler();
		c.modeles.signaler();
		expect(await jusqua(() => modelesRecus(recus).length > 0, 2000)).toBe(true);
		await attendre(200);
		// la rafale ne fait qu'un message
		expect(modelesRecus(recus)).toEqual([c.modeles.vue]);
	});

	it('sans signal, le sondage de secours voit le changement', async () => {
		const c = await serviceFaux({ sondageModelesMs: 100 });
		const recus = await ecouter(c);
		await attendre(150);
		c.modeles.vue = { ...c.modeles.vue, gardien: 'demarrage' };
		expect(await jusqua(() => modelesRecus(recus).some((m) => m.gardien === 'demarrage'), 2000)).toBe(true);
		await attendre(300);
		expect(modelesRecus(recus)).toHaveLength(1);
	});

	it('un geste (niveau) est diffusé aux autres clients ; l’arrêt du service arrête la surveillance', async () => {
		const c = await serviceFaux({ sondageModelesMs: 60_000 });
		const recus = await ecouter(c);
		await attendre(100);
		expect(c.modeles.surveillances).toBe(1);
		await api(c).put(ROUTES.modelesNiveau, { niveau: 'coupes' });
		expect(await jusqua(() => modelesRecus(recus).some((m) => m.niveau === 'coupes'), 2000)).toBe(true);
		await c.service.arreter();
		expect(c.modeles.surveillances).toBe(0);
	});
});
