import { describe, expect, it } from 'vitest';
import { estIdMoteur, estModele, IDS_MOTEURS, MODELE_MAX, MOTEUR_PAR_DEFAUT } from '../src/index.ts';

describe('moteurs', () => {
	it('Claude Code, Codex et Mistral Vibe ; Claude Code par défaut', () => {
		expect(IDS_MOTEURS).toEqual(['claude-code', 'codex', 'mistral-vibe']);
		expect(MOTEUR_PAR_DEFAUT).toBe('claude-code');
		expect(estIdMoteur('codex')).toBe(true);
		expect(estIdMoteur('gemini')).toBe(false);
		expect(estIdMoteur(undefined)).toBe(false);
	});

	it('modèle : vide (celui par défaut du moteur) ou un nom ASCII court de la liste blanche, jamais une option', () => {
		for (const bon of ['', 'opus', 'claude-opus-5-5', 'gpt-6.2-sol', 'sonnet[1m]', 'org/modele:v2', 'a@b+c_d', 'a'.repeat(MODELE_MAX)]) expect(estModele(bon), bon).toBe(true);
		for (const mauvais of [' opus', 'opus ', '-x', '--model', 'op\nus', 'op\tus', 'op\u0000us', 'op’us', "op'us", 'op\u202Eus', 'opus\u200B', 'opüs', 'op us', '.opus', 'a'.repeat(MODELE_MAX + 1), 3, null, undefined, ['opus']]) {
			expect(estModele(mauvais), String(mauvais)).toBe(false);
		}
	});
});
