/** Remèdes d'un moteur sur le poste : tirés de son installation, les mêmes pour la CLI, le HTTP et l'avertissement de session. */
import { describe, expect, it } from 'vitest';
import { avertissementDesHooks } from '../../src/application/moteurs/avertissements-de-session.ts';
import { remedesDuMoteur } from '../../src/application/moteurs/remedes.ts';
import { lireOptionsInit } from '../../src/adaptateurs/cli/init-options.ts';
import { MOTEURS_DU_POSTE, MOTEURS_FACULTATIFS } from '../../src/infra/moteurs/moteurs.ts';

describe('remèdes des moteurs', () => {
	it('commandes tirées de l’installation ; moteur par défaut sans --moteur', () => {
		expect(remedesDuMoteur(MOTEURS_DU_POSTE['claude-code'])).toEqual({ declarer: 'mnemo init --mcp', remplacer: 'mnemo declarer --remplacer', retirer: 'mnemo declarer --retirer' });
		expect(remedesDuMoteur(MOTEURS_DU_POSTE['mistral-vibe'])).toEqual({
			declarer: 'mnemo init --mistral',
			remplacer: 'mnemo declarer --moteur mistral-vibe --remplacer',
			retirer: 'mnemo declarer --moteur mistral-vibe --retirer',
		});
	});

	it('avertissement de session : hooks absents, la vraie option d’init (acceptée par init)', () => {
		const texte = avertissementDesHooks(MOTEURS_DU_POSTE['mistral-vibe'], { etat: 'absent', chemin: '/h/.vibe/hooks.toml' });
		expect(texte).toContain('« mnemo init --mistral »');
		expect(avertissementDesHooks(MOTEURS_DU_POSTE.codex, { etat: 'perime', chemin: '/h/.codex/hooks.json' })).toContain('« mnemo declarer --moteur codex --remplacer »');
		for (const m of MOTEURS_FACULTATIFS) expect(lireOptionsInit([m.installation.optionInit]).moteurs).toEqual([m.id]);
	});
});
