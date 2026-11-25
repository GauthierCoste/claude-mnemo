import { describe, expect, it } from 'vitest';
import { estIdMoteur, estModele, IDS_MOTEURS, MODELE_MAX, MOTEUR_PAR_DEFAUT } from '../src/index.ts';

describe('moteurs', () => {
	it('Claude Code et Codex ; Claude Code par défaut', () => {
		expect(IDS_MOTEURS).toEqual(['claude-code', 'codex']);
		expect(MOTEUR_PAR_DEFAUT).toBe('claude-code');
		expect(estIdMoteur('codex')).toBe(true);
		expect(estIdMoteur('gemini')).toBe(false);
		expect(estIdMoteur(undefined)).toBe(false);
	});

	it('modèle : vide (celui par défaut du moteur) ou un nom court, sans contrôle, espace de bord ni « - » au début', () => {
		for (const bon of ['', 'opus', 'claude-opus-5-5', 'gpt-6.2-sol', 'sonnet[1m]', 'a'.repeat(MODELE_MAX)]) expect(estModele(bon), bon).toBe(true);
		for (const mauvais of [' opus', 'opus ', '-x', '--model', 'op\nus', 'op\tus', 'op\u0000us', 'a'.repeat(MODELE_MAX + 1), 3, null, undefined, ['opus']]) {
			expect(estModele(mauvais), String(mauvais)).toBe(false);
		}
	});
});
