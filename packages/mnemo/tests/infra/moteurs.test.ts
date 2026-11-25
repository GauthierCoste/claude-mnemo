import { describe, expect, it } from 'vitest';
import { CONTRAT_DES_FACULTATIFS, MOTEURS_FACULTATIFS } from '../../src/adaptateurs/cli/moteurs-facultatifs.ts';
import { hooksDuMoteur } from '../../src/application/moteurs/hooks.ts';
import { IDS_MOTEURS } from '@mnemo/commun';
import { CATALOGUE_MOTEURS } from '../../src/domaine/moteurs/catalogue.ts';
import { outilsDuMoteur } from '../../src/domaine/moteurs/outils.ts';
import { MOTEURS, MOTEURS_DU_POSTE } from '../../src/infra/moteurs/moteurs.ts';

describe('moteurs : un seul registre de vérité', () => {
	it('les hooks et les outils de chaque moteur sont ceux des registres purs', () => {
		expect(MOTEURS.length).toBeGreaterThan(0);
		for (const m of MOTEURS) {
			expect(m.hooks, m.id).toBe(hooksDuMoteur(m.id));
			expect(m.outils, m.id).toBe(outilsDuMoteur(m.id));
		}
	});

	it('moteurs de sessions et du poste dans l’ordre des identifiants ; facultatifs du catalogue = ceux qui ont leur bloc et leurs étapes dans le contrat', () => {
		expect(MOTEURS.map((m) => m.id)).toEqual([...IDS_MOTEURS]);
		for (const id of IDS_MOTEURS) expect(MOTEURS_DU_POSTE[id].id).toBe(id);
		expect(IDS_MOTEURS.filter((id) => CATALOGUE_MOTEURS[id].facultatif)).toEqual(Object.keys(CONTRAT_DES_FACULTATIFS));
		expect(MOTEURS_FACULTATIFS.map((m) => [m.id, m.nom, m.optionInit, m.moteur.id])).toEqual(
			IDS_MOTEURS.filter((id) => CATALOGUE_MOTEURS[id].facultatif).map((id) => [id, CATALOGUE_MOTEURS[id].nom, CATALOGUE_MOTEURS[id].optionInit, id]),
		);
	});

	it('Claude Code : sa marque de session est l’uuid de Mnemo', () => {
		const claude = MOTEURS.find((m) => m.id === 'claude-code')!;
		expect(claude.marqueDeSession('11111111-2222-4333-8444-555555555555')).toBe('11111111-2222-4333-8444-555555555555');
	});

	it('Codex : sa marque de session est l’argument `mnemo_session=\'<uuid>\'` de `-c`, tel que `preparer` le passe', () => {
		const codex = MOTEURS.find((m) => m.id === 'codex')!;
		const uuid = '11111111-2222-4333-8444-555555555555';
		expect(codex.marqueDeSession(uuid)).toBe(`mnemo_session='${uuid}'`);
	});
});
