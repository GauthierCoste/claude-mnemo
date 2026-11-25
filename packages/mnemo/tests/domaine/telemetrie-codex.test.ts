import { describe, expect, it } from 'vitest';
import { quotasDeCodex, telemetrieDeCodex } from '../../src/domaine/moteurs/codex/telemetrie.ts';

/** Un `token_count` de rollout écrit à la main, sur le modèle de ceux de Codex 0.171. */
function tokenCount(e: { entree?: number; cache?: number; sortie?: number; fenetre?: number; info?: null; limites?: unknown; instant?: string }): string {
	const usage = { input_tokens: e.entree ?? 20_000, cached_input_tokens: e.cache ?? 15_000, output_tokens: e.sortie ?? 50, reasoning_output_tokens: 0, total_tokens: (e.entree ?? 20_000) + (e.sortie ?? 50) };
	const info = e.info === null ? null : { total_token_usage: usage, last_token_usage: usage, model_context_window: e.fenetre ?? 400_000 };
	const limites = e.limites === undefined ? { limit_id: 'codex', primary: { used_percent: 12.6, window_minutes: 10_080, resets_at: 1_796_000_000 }, secondary: null, plan_type: 'plus' } : e.limites;
	return JSON.stringify({ timestamp: e.instant ?? '2026-11-25T10:00:00.000Z', type: 'event_msg', payload: { type: 'token_count', info, rate_limits: limites } });
}

const message = JSON.stringify({ timestamp: '2026-11-25T10:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [] } });

describe('telemetrieDeCodex', () => {
	it('fenêtre du dernier token_count : entrée (cache compris) et sortie sur la fenêtre du modèle', () => {
		const lignes = [tokenCount({ entree: 10_000 }), message, tokenCount({ entree: 30_000, cache: 28_000, sortie: 120, fenetre: 475_000 }), message];
		expect(telemetrieDeCodex(lignes).fenetre).toEqual({ utilises: 30_120, max: 475_000 });
	});

	it('quotas du dernier token_count, relevés à son instant', () => {
		expect(telemetrieDeCodex([tokenCount({ instant: '2026-11-25T10:00:00.000Z' })]).quotas).toEqual({
			semaine: { pourcentage: 13, remiseMs: 1_796_000_000_000 },
			releveMs: Date.parse('2026-11-25T10:00:00.000Z'),
		});
	});

	it('remonte jusqu’au token_count qui porte chacun : info nulle, quotas absents', () => {
		const lignes = [tokenCount({ entree: 8_000 }), tokenCount({ info: null, limites: { limit_id: 'codex', primary: { used_percent: 40, window_minutes: 300, resets_at: 1_795_000_000 } } })];
		expect(telemetrieDeCodex(lignes)).toEqual({ fenetre: { utilises: 8_050, max: 400_000 }, quotas: { cinqHeures: { pourcentage: 40, remiseMs: 1_795_000_000_000 }, releveMs: Date.parse('2026-11-25T10:00:00.000Z') } });
		expect(telemetrieDeCodex([tokenCount({ limites: null })])).toEqual({ fenetre: { utilises: 20_050, max: 400_000 } });
	});

	it('ignore une dernière ligne tronquée (en cours d’écriture)', () => {
		const tronquee = tokenCount({ entree: 99_000 }).slice(0, 120);
		expect(telemetrieDeCodex([tokenCount({ entree: 10_000 }), tronquee]).fenetre).toEqual({ utilises: 10_050, max: 400_000 });
	});

	it('rien sans token_count lisible', () => {
		expect(telemetrieDeCodex([])).toEqual({});
		expect(telemetrieDeCodex([message, '{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{}}}}'])).toEqual({});
	});
});

describe('quotasDeCodex', () => {
	it('range primary et secondary selon leur durée ; pourcentage arrondi et borné', () => {
		const limites = { primary: { used_percent: 130, window_minutes: 300, resets_at: 10 }, secondary: { used_percent: 2.4, window_minutes: 10_080, resets_at: 20 } };
		expect(quotasDeCodex(limites)).toEqual({ cinqHeures: { pourcentage: 100, remiseMs: 10_000 }, semaine: { pourcentage: 2, remiseMs: 20_000 } });
	});

	it('tolère une durée à peine différente : 299 min pour 5 heures, 10 079 pour la semaine', () => {
		const limites = { primary: { used_percent: 1, window_minutes: 299, resets_at: 10 }, secondary: { used_percent: 2, window_minutes: 10_079, resets_at: 20 } };
		expect(quotasDeCodex(limites)).toEqual({ cinqHeures: { pourcentage: 1, remiseMs: 10_000 }, semaine: { pourcentage: 2, remiseMs: 20_000 } });
		expect(quotasDeCodex({ primary: { used_percent: 1, window_minutes: 306, resets_at: 10 }, secondary: { used_percent: 2, window_minutes: 10_111, resets_at: 20 } })).toBeNull();
	});

	it('null sans fenêtre lisible, d’une durée inconnue, ou d’une autre limite que celle de l’abonnement', () => {
		expect(quotasDeCodex(undefined)).toBeNull();
		expect(quotasDeCodex({ primary: null, secondary: null })).toBeNull();
		expect(quotasDeCodex({ primary: { used_percent: 5, window_minutes: 60, resets_at: 10 } })).toBeNull();
		expect(quotasDeCodex({ primary: { used_percent: '5', window_minutes: 300, resets_at: 10 } })).toBeNull();
		expect(quotasDeCodex({ limit_id: 'autre', primary: { used_percent: 5, window_minutes: 300, resets_at: 10 } })).toBeNull();
	});
});
