import { describe, expect, it } from 'vitest';
import { ROUTES } from '@mnemo/contrat';
import { appeler, serviceFaux } from '../aides/service-faux.ts';

/** Vrai si la promesse est résolue avant `ms`. */
const resolueAvant = (p: Promise<void>, ms: number): Promise<boolean> => Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);

describe('arrêt par l’API (toutes plateformes, sans signal)', () => {
	it('POST arret avec le jeton : 202, l’arrêt est demandé au processus et journalisé', async () => {
		const lignes: string[] = [];
		const c = await serviceFaux({ journal: (m) => lignes.push(m) });
		try {
			const r = await appeler(c.service.port, 'POST', ROUTES.arret, { jeton: c.service.jeton, corps: {} });
			expect(r.statut).toBe(202);
			expect(await resolueAvant(c.service.arretDemande, 2000)).toBe(true);
			expect(lignes.join('\n')).toMatch(/arrêt demandé/u);
		} finally {
			await c.service.arreter();
		}
	});

	it('sans jeton, avec un faux jeton ou en GET : refusé, aucun arrêt demandé', async () => {
		const c = await serviceFaux();
		try {
			expect((await appeler(c.service.port, 'POST', ROUTES.arret, { corps: {} })).statut).toBe(401);
			expect((await appeler(c.service.port, 'POST', ROUTES.arret, { jeton: `${c.service.jeton}0`, corps: {} })).statut).toBe(401);
			expect((await appeler(c.service.port, 'GET', ROUTES.arret, { jeton: c.service.jeton })).statut).toBe(404);
			expect(await resolueAvant(c.service.arretDemande, 300)).toBe(false);
		} finally {
			await c.service.arreter();
		}
	});
});
