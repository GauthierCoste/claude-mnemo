import { describe, expect, it } from 'vitest';
import { decisionSurInactivite } from '../../src/infra/modeles/gardien.ts';

const QUINZE_MINUTES = 15 * 60_000;

describe('decisionSurInactivite', () => {
	it('ne s’arrête jamais pour inactivité tant que le service est vivant', () => {
		expect(decisionSurInactivite({ serviceVivant: true, serviceVuVivant: true, inactifDepuisMs: 10 * QUINZE_MINUTES, inactiviteMs: QUINZE_MINUTES })).toEqual({ arreter: false });
	});

	it('s’arrête quand le service, vu vivant, ne l’est plus', () => {
		expect(decisionSurInactivite({ serviceVivant: false, serviceVuVivant: true, inactifDepuisMs: 0, inactiviteMs: QUINZE_MINUTES })).toEqual({ arreter: true, motif: 'service arrêté' });
	});

	it('sans service jamais vu, garde l’arrêt après le temps d’inactivité', () => {
		const sansService = { serviceVivant: false, serviceVuVivant: false, inactiviteMs: QUINZE_MINUTES };
		expect(decisionSurInactivite({ ...sansService, inactifDepuisMs: QUINZE_MINUTES - 1 })).toEqual({ arreter: false });
		expect(decisionSurInactivite({ ...sansService, inactifDepuisMs: QUINZE_MINUTES + 1 })).toEqual({ arreter: true, motif: '900 s sans requête' });
	});
});
