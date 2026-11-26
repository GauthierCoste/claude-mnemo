/** Remèdes d'un moteur sur le poste : tirés de son installation, les mêmes pour la CLI, le HTTP et l'avertissement de session. */
import { describe, expect, it } from 'vitest';
import { avertissementDesHooks } from '../../src/application/moteurs/avertissements-de-session.ts';
import { remedesDuMoteur } from '../../src/application/moteurs/remedes.ts';
import { lireOptionsInit } from '../../src/adaptateurs/cli/init-options.ts';
import { IDS_MOTEURS } from '../../src/domaine/moteurs/moteur.ts';
import { MOTEURS_FACULTATIFS } from '../../src/adaptateurs/cli/moteurs-facultatifs.ts';
import { MOTEURS_DU_POSTE } from '../../src/infra/moteurs/moteurs.ts';

describe('remèdes des moteurs', () => {
	it('commandes tirées de l’installation ; moteur par défaut sans --moteur', () => {
		expect(remedesDuMoteur(MOTEURS_DU_POSTE['claude-code'])).toEqual({ declarer: 'mnemo declarer --lier', remplacer: 'mnemo declarer --lier' });
		expect(remedesDuMoteur(MOTEURS_DU_POSTE['mistral-vibe'])).toEqual({ declarer: 'mnemo declarer --moteur mistral-vibe --lier', remplacer: 'mnemo declarer --moteur mistral-vibe --lier' });
	});

	it('avertissement de session : hooks absents ou périmés, la commande qui lie le moteur', () => {
		const texte = avertissementDesHooks(MOTEURS_DU_POSTE['mistral-vibe'], { etat: 'absent', chemin: '/h/.vibe/hooks.toml' });
		expect(texte).toContain('« mnemo declarer --moteur mistral-vibe --lier »');
		expect(avertissementDesHooks(MOTEURS_DU_POSTE.codex, { etat: 'perime', chemin: '/h/.codex/hooks.json' })).toContain('« mnemo declarer --moteur codex --lier »');
		for (const m of MOTEURS_FACULTATIFS) expect(lireOptionsInit([m.optionInit]).moteurs).toEqual([m.id]);
	});

	it('registre : chaque identifiant a son moteur du poste', () => {
		for (const id of IDS_MOTEURS) expect(MOTEURS_DU_POSTE[id]?.id).toBe(id);
	});
});
