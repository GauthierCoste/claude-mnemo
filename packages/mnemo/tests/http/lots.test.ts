import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { ROUTES } from '@mnemo/contrat';
import type { MessageServeur, ReponseLots, ReponseRejetLot, ReponseValidationLot } from '@mnemo/contrat';
import { entretenir } from '../../src/application/entretenir.ts';
import type { DemandeLot } from '../../src/application/entretenir.ts';
import { appeler, jusqua, serviceFaux } from '../aides/service-faux.ts';
import type { ContexteService } from '../aides/service-faux.ts';
import { ligne, remplir } from '../aides/memoire-lots.ts';

const ACME = 'clients/acme.md';
const chemin = (route: string, id: string) => route.replace(':id', encodeURIComponent(id));

const clients: WebSocket[] = [];
afterEach(() => {
	while (clients.length > 0) clients.pop()!.terminate();
});

function api(c: ContexteService) {
	const { port, jeton } = c.service;
	return {
		get: (route: string) => appeler(port, 'GET', route, { jeton }),
		post: (route: string, corps?: unknown) => appeler(port, 'POST', route, { jeton, corps: corps ?? {} }),
	};
}

async function avecLot(genre: DemandeLot['genre'], lignes: DemandeLot['lignes'], reglages = {}): Promise<{ c: ContexteService; id: string }> {
	const c = await serviceFaux(reglages);
	remplir(c.dep);
	const r = await entretenir(c.dep, { action: 'proposer_lot', id: ACME, genre, lignes, motif: 'Ménage' });
	if (r.statut !== 'lot_propose') throw new Error('lot refusé');
	return { c, id: r.lot };
}

describe('routes des lots d\'informations', () => {
	it('GET lots : les lots en attente, chaque ligne avec son avant et son après', async () => {
		const { c, id } = await avecLot('supprimer', [{ ancre: 'f-0005' }, { ancre: 'f-0006' }]);
		const r = await api(c).get(ROUTES.lots);
		expect(r.statut).toBe(200);
		const { lots } = r.corps as ReponseLots;
		expect(lots).toEqual([
			{
				id,
				genre: 'supprimer',
				fiche: ACME,
				titre: 'Acme',
				motif: 'Ménage',
				proposeMs: new Date(2026, 10, 22, 12, 0, 0).getTime(),
				session: null,
				perime: false,
				lignes: [
					{ indice: 0, ligne: { ancre: 'f-0005' }, avant: [{ ancre: 'f-0005', lignes: [ligne(5)] }], apres: null, motif: null, deja: false },
					{ indice: 1, ligne: { ancre: 'f-0006' }, avant: [{ ancre: 'f-0006', lignes: [ligne(6)] }], apres: null, motif: null, deja: false },
				],
			},
		]);
	});

	it('valider en partie : 200, un commit, le lot disparaît ; une seconde fois : 404', async () => {
		const { c, id } = await avecLot('supprimer', [{ ancre: 'f-0005' }, { ancre: 'f-0006' }]);
		const r = await api(c).post(chemin(ROUTES.lotValider, id), { lignes: [1] });
		expect(r.statut).toBe(200);
		expect(r.corps).toMatchObject({ id, fiche: ACME, commit: 'c000001', lignes: [1] } satisfies Partial<ReponseValidationLot>);
		expect(c.dep.fichiers.get(ACME)).toContain(ligne(5));
		expect(c.dep.fichiers.get(ACME)).not.toContain('Budget de 1200');
		expect(c.dep.commits.map((m) => m.message)).toEqual(['mnemo: supprime 1 information clients/acme.md']);
		expect(((await api(c).get(ROUTES.lots)).corps as ReponseLots).lots).toEqual([]);
		expect((await api(c).post(chemin(ROUTES.lotValider, id), { lignes: [0] })).statut).toBe(404);
	});

	it('corps ou choix invalide : 400, rien n\'est écrit, le lot reste', async () => {
		const { c, id } = await avecLot('supprimer', [{ ancre: 'f-0005' }]);
		for (const corps of [{}, { lignes: 'tout' }, { lignes: [0], autre: 1 }, { lignes: [] }, { lignes: [3] }, { lignes: [0, 0] }]) {
			const r = await api(c).post(chemin(ROUTES.lotValider, id), corps);
			expect(r.statut).toBe(400);
			expect(r.corps).toMatchObject({ erreur: expect.any(String) });
		}
		expect(c.dep.commits).toEqual([]);
		expect(((await api(c).get(ROUTES.lots)).corps as ReponseLots).lots).toHaveLength(1);
	});

	it('une information visée a changé depuis la proposition : 409, le lot est écarté', async () => {
		const { c, id } = await avecLot('supprimer', [{ ancre: 'f-0005' }]);
		c.dep.fichiers.set(ACME, c.dep.fichiers.get(ACME)!.replace('s\'appelle Corbano', 's\'appelle Corbani'));
		expect(((await api(c).get(ROUTES.lots)).corps as ReponseLots).lots[0]!.perime).toBe(true);
		expect((await api(c).post(chemin(ROUTES.lotValider, id), { lignes: [0] })).statut).toBe(409);
		expect(c.dep.commits).toEqual([]);
		expect(((await api(c).get(ROUTES.lots)).corps as ReponseLots).lots).toEqual([]);
	});

	it('fiche supprimée depuis la proposition : 409, le lot est écarté', async () => {
		const { c, id } = await avecLot('supprimer', [{ ancre: 'f-0005' }]);
		c.dep.fichiers.delete(ACME);
		expect((await api(c).post(chemin(ROUTES.lotValider, id), { lignes: [0] })).statut).toBe(409);
		expect(((await api(c).get(ROUTES.lots)).corps as ReponseLots).lots).toEqual([]);
	});

	it('rejeter : 200, rien n\'est écrit, le lot disparaît ; inconnu : 404', async () => {
		const { c, id } = await avecLot('confirmer', [{ ancre: 'f-0006' }]);
		const avant = new Map(c.dep.fichiers);
		const r = await api(c).post(chemin(ROUTES.lotRejeter, id));
		expect(r.statut).toBe(200);
		expect(r.corps).toEqual({ id } satisfies ReponseRejetLot);
		expect(c.dep.fichiers).toEqual(avant);
		expect(c.dep.commits).toEqual([]);
		expect(((await api(c).get(ROUTES.lots)).corps as ReponseLots).lots).toEqual([]);
		expect((await api(c).post(chemin(ROUTES.lotRejeter, id))).statut).toBe(404);
		expect((await api(c).post(chemin(ROUTES.lotRejeter, 'inconnu'))).statut).toBe(404);
	});

	it('WebSocket : `lots` diffusé quand un lot est proposé (sondage : un serveur MCP l\'enregistre hors du service) ou rejeté', async () => {
		const { c, id } = await avecLot('supprimer', [{ ancre: 'f-0005' }], { sondageMs: 30 });
		const recus: MessageServeur[] = [];
		await new Promise<void>((resoudre, rejeter) => {
			const ws = new WebSocket(`ws://127.0.0.1:${c.service.port}${ROUTES.ws}?jeton=${c.service.jeton}`);
			clients.push(ws);
			ws.on('message', (brut) => recus.push(JSON.parse(String(brut)) as MessageServeur));
			ws.once('open', () => resoudre());
			ws.once('error', rejeter);
		});
		// le premier sondage sert de référence
		await new Promise((r) => setTimeout(r, 100));
		const r = await entretenir(c.dep, { action: 'proposer_lot', id: ACME, genre: 'confirmer', lignes: [{ ancre: 'f-0006' }], motif: 'À confirmer' });
		expect(r.statut).toBe('lot_propose');
		expect(await jusqua(() => recus.some((m) => m.type === 'lots'), 2000)).toBe(true);
		const avant = recus.filter((m) => m.type === 'lots').length;
		expect((await api(c).post(chemin(ROUTES.lotRejeter, id))).statut).toBe(200);
		expect(await jusqua(() => recus.filter((m) => m.type === 'lots').length > avant, 2000)).toBe(true);
	});
});
