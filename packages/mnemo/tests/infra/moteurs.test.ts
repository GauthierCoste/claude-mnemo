import { describe, expect, it } from 'vitest';
import { hooksDuMoteur } from '../../src/application/moteurs/hooks.ts';
import { outilsDuMoteur } from '../../src/domaine/moteurs/outils.ts';
import { MOTEURS } from '../../src/infra/moteurs/moteurs.ts';

describe('moteurs : un seul registre de vérité', () => {
	it('les hooks et les outils de chaque moteur sont ceux des registres purs', () => {
		expect(MOTEURS.length).toBeGreaterThan(0);
		for (const m of MOTEURS) {
			expect(m.hooks, m.id).toBe(hooksDuMoteur(m.id));
			expect(m.outils, m.id).toBe(outilsDuMoteur(m.id));
		}
	});

	it('Claude Code : sa marque de session est l’uuid de Mnemo', () => {
		const claude = MOTEURS.find((m) => m.id === 'claude-code')!;
		expect(claude.marqueDeSession('11111111-2222-4333-8444-555555555555')).toBe('11111111-2222-4333-8444-555555555555');
	});

	it('Codex : sa marque de session est l’argument `mnemo_session="<uuid>"` de `-c`, tel que `preparer` le passe', () => {
		const codex = MOTEURS.find((m) => m.id === 'codex')!;
		const uuid = '11111111-2222-4333-8444-555555555555';
		expect(codex.marqueDeSession(uuid)).toBe(`mnemo_session="${uuid}"`);
	});
});
