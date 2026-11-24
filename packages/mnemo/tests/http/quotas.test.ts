import { describe, expect, it } from 'vitest';
import { ROUTES } from '@mnemo/contrat';
import { appeler, serviceFaux } from '../aides/service-faux.ts';

describe('routes : quotas du compte', () => {
	it('GET : null avant tout relevé ; POST garde le dernier relevé, que GET rend ensuite', async () => {
		const c = await serviceFaux();
		const jeton = c.service.jeton;
		expect((await appeler(c.service.port, 'GET', ROUTES.quotas, { jeton })).corps).toEqual({ quotas: null });
		const limites = { five_hour: { used_percentage: 42, resets_at: 1_795_600_000 }, seven_day: { used_percentage: 61, resets_at: 1_796_000_000 } };
		const quotas = { cinqHeures: { pourcentage: 42, remiseMs: 1_795_600_000_000 }, semaine: { pourcentage: 61, remiseMs: 1_796_000_000_000 } };
		const r = await appeler(c.service.port, 'POST', ROUTES.quotas, { jeton, corps: { rate_limits: limites } });
		expect(r.statut).toBe(200);
		expect(r.corps).toEqual({ quotas });
		expect((await appeler(c.service.port, 'GET', ROUTES.quotas, { jeton })).corps).toEqual({ quotas });
	});

	it('POST sans fenêtre lisible : 400, le relevé précédent reste', async () => {
		const c = await serviceFaux();
		const jeton = c.service.jeton;
		const r = await appeler(c.service.port, 'POST', ROUTES.quotas, { jeton, corps: { rate_limits: {} } });
		expect(r.statut).toBe(400);
		expect((await appeler(c.service.port, 'GET', ROUTES.quotas, { jeton })).corps).toEqual({ quotas: null });
	});

	it('jeton exigé', async () => {
		const c = await serviceFaux();
		expect((await appeler(c.service.port, 'GET', ROUTES.quotas, {})).statut).toBe(401);
	});
});
