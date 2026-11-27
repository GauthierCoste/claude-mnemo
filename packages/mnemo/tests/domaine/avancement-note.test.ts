import { describe, expect, it } from 'vitest';
import { avancementDes, partDuVolume, volumesDe } from '../../src/domaine/avancement-note.ts';

describe('avancement vers les vrais résultats', () => {
	it('le volume le plus en retard : 2 fiches injectables sur 25 → 8 %', () => {
		const volumes = volumesDe({ injections: 2, sessions: 2, silences: 16, sessionsSilence: 11 });
		expect(volumes.map((v) => [v.nom, v.fait, v.cible])).toEqual([
			['injections', 2, 25],
			['sessions', 2, 10],
			['silences', 16, 20],
		]);
		expect(avancementDes(volumes)).toBeCloseTo(0.08);
	});

	it('silences : le moins avancé des messages et de leurs sessions ; borné à 1 ; sans sessions (modèle d’avant) : les messages seuls', () => {
		expect(partDuVolume({ nom: 'silences', fait: 40, cible: 20, sessions: { fait: 2, cible: 5 } })).toBeCloseTo(0.4);
		expect(partDuVolume({ nom: 'injections', fait: 60, cible: 25 })).toBe(1);
		expect(volumesDe({ injections: 0, sessions: 0, silences: 4 })[2]).toEqual({ nom: 'silences', fait: 4, cible: 20 });
	});
});
