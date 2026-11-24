import { describe, expect, it } from 'vitest';
import { memesQuotas, quotasDeLimites } from '../../src/domaine/quotas.ts';

describe('quotasDeLimites', () => {
	it('lit les deux fenêtres : pourcentage arrondi, remise en millisecondes', () => {
		expect(quotasDeLimites({ five_hour: { used_percentage: 42.4, resets_at: 1_795_600_000 }, seven_day: { used_percentage: 61, resets_at: 1_796_000_000 } })).toEqual({
			cinqHeures: { pourcentage: 42, remiseMs: 1_795_600_000_000 },
			semaine: { pourcentage: 61, remiseMs: 1_796_000_000_000 },
		});
	});

	it('garde une fenêtre seule ; borne le pourcentage entre 0 et 100', () => {
		expect(quotasDeLimites({ seven_day: { used_percentage: 130, resets_at: 10 } })).toEqual({ semaine: { pourcentage: 100, remiseMs: 10_000 } });
		expect(quotasDeLimites({ five_hour: { used_percentage: -3, resets_at: 10 } })).toEqual({ cinqHeures: { pourcentage: 0, remiseMs: 10_000 } });
	});

	it('null sans fenêtre lisible', () => {
		expect(quotasDeLimites(undefined)).toBeNull();
		expect(quotasDeLimites({})).toBeNull();
		expect(quotasDeLimites({ five_hour: { used_percentage: '42', resets_at: 10 } })).toBeNull();
		expect(quotasDeLimites({ five_hour: { used_percentage: 42 } })).toBeNull();
		expect(quotasDeLimites({ five_hour: { used_percentage: Number.NaN, resets_at: 10 } })).toBeNull();
		expect(quotasDeLimites([{ used_percentage: 1, resets_at: 1 }])).toBeNull();
	});

	it('ignore les autres fenêtres (spend_limit)', () => {
		expect(quotasDeLimites({ spend_limit: { used_percentage: 10, resets_at: 10 } })).toBeNull();
	});
});

describe('memesQuotas', () => {
	const q = { cinqHeures: { pourcentage: 42, remiseMs: 1 } };
	it('compare chaque fenêtre', () => {
		expect(memesQuotas(q, { cinqHeures: { pourcentage: 42, remiseMs: 1 } })).toBe(true);
		expect(memesQuotas(q, { cinqHeures: { pourcentage: 43, remiseMs: 1 } })).toBe(false);
		expect(memesQuotas(q, { ...q, semaine: { pourcentage: 1, remiseMs: 1 } })).toBe(false);
		expect(memesQuotas(null, q)).toBe(false);
		expect(memesQuotas(null, null)).toBe(true);
	});
});
