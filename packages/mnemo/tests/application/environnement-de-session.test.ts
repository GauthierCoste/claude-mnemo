import { describe, expect, it } from 'vitest';
import { environnementPermis, estDUnAutreFournisseur, variablesRetirees } from '../../src/application/moteurs/environnement-de-session.ts';
import type { IdMoteur } from '../../src/domaine/moteurs/moteur.ts';

const ENV = {
	PATH: '/bin',
	CLAUDECODE: '1',
	CLAUDE_CODE_ENTRYPOINT: 'cli',
	ANTHROPIC_API_KEY: 'sk-ant',
	CODEX_API_KEY: 'k',
	OPENAI_API_KEY: 'sk',
	MISTRAL_API_KEY: 'm',
	COPILOT_GITHUB_TOKEN: 'gho',
	GH_TOKEN: 'ghp',
	GITHUB_TOKEN: 'ghp2',
	VIDE: undefined,
};

describe("variables d'un autre fournisseur", () => {
	it('chaque moteur garde les siennes, GH_TOKEN, GITHUB_TOKEN et le reste ; les autres retirées, COPILOT_GITHUB_TOKEN chez tous', () => {
		const gardees: Record<IdMoteur, string[]> = {
			'claude-code': ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'ANTHROPIC_API_KEY'],
			codex: ['CODEX_API_KEY', 'OPENAI_API_KEY'],
			'mistral-vibe': ['MISTRAL_API_KEY'],
		};
		for (const [moteur, siennes] of Object.entries(gardees) as [IdMoteur, string[]][]) {
			expect(Object.keys(environnementPermis(moteur, ENV)).sort()).toEqual(['GH_TOKEN', 'GITHUB_TOKEN', 'PATH', ...siennes].sort());
		}
	});

	it('comparées sans la casse (Windows) ; la règle propre au moteur s’y ajoute', () => {
		expect(estDUnAutreFournisseur('codex', 'ANTHROPIC_BASE_URL')).toBe(true);
		expect(variablesRetirees('mistral-vibe', { Openai_Api_Key: 'sk', claude_code_use_bedrock: '1', PATH: '/bin' })).toEqual(['Openai_Api_Key', 'claude_code_use_bedrock']);
		expect(variablesRetirees('codex', { CODEX_API_KEY: 'k', OPENAI_API_KEY: 'sk' }, (m) => m === 'CODEX_API_KEY')).toEqual(['CODEX_API_KEY']);
	});
});
