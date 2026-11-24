import { describe, expect, it } from 'vitest';
import { quotasEnCours, remiseLisible } from '../../src/composants/Quotas.tsx';

const midi = new Date(2026, 10, 24, 12, 0).getTime();

describe('remiseLisible', () => {
	it("l'heure seule le jour même, le jour de la semaine sinon", () => {
		expect(remiseLisible(new Date(2026, 10, 24, 18, 0).getTime(), midi)).toBe('18:00');
		expect(remiseLisible(new Date(2026, 10, 30, 9, 5).getTime(), midi)).toBe('lun. 09:05');
	});
});

describe('quotasEnCours', () => {
	it('retire une fenêtre passée sa remise à zéro', () => {
		const q = { cinqHeures: { pourcentage: 90, remiseMs: midi - 1 }, semaine: { pourcentage: 61, remiseMs: midi + 1 } };
		expect(quotasEnCours(q, midi)).toEqual({ semaine: q.semaine });
		expect(quotasEnCours(null, midi)).toEqual({});
	});
});
