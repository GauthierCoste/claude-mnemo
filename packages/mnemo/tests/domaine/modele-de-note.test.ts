import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COEFFICIENTS_NOTE } from '../../src/domaine/coefficients-note.ts';
import { moduleDeCoefficients, NIVEAUX_DE_NOTE, VARIABLES_DU_NIVEAU, VARIABLES_MAX, variablesDeNote } from '../../src/domaine/modele-de-note.ts';

describe('variablesDeNote', () => {
	const s = { logit: 2.5, cosinusRelatif: 0.12, cosinusZ: 1.8, bm25Relatif: null, signalSession: 0.4, apriori: -0.3 };

	it('les variables du niveau, dans l’ordre ; bm25 null vaut 0', () => {
		expect(variablesDeNote('complets', s, 'mediane')).toEqual([2.5, 0.12, 0, 0.4, -0.3]);
		expect(variablesDeNote('sens', s, 'zscore')).toEqual([1.8, 0, 0.4, -0.3]);
		expect(variablesDeNote('sens', s, 'mediane', false)).toEqual([0.12, 0, 0.4, 0]);
	});

	it('null quand une variable nécessaire manque', () => {
		expect(variablesDeNote('complets', { ...s, logit: null }, 'mediane')).toBeNull();
		expect(variablesDeNote('sens', { ...s, logit: null }, 'mediane')).not.toBeNull();
		expect(variablesDeNote('sens', { ...s, cosinusRelatif: null }, 'mediane')).toBeNull();
		expect(variablesDeNote('sens', { cosinusRelatif: 0.1, bm25Relatif: 0.5 }, 'zscore')).toBeNull();
		expect(variablesDeNote('sens', { cosinusRelatif: 0.1, bm25Relatif: 0.5 }, 'mediane')).toEqual([0.1, 0.5, 0, 0]);
	});

	it('6 variables au plus par niveau', () => {
		for (const n of NIVEAUX_DE_NOTE) expect(VARIABLES_DU_NIVEAU[n].length).toBeLessThanOrEqual(VARIABLES_MAX);
	});
});

describe('coefficients-note.ts', () => {
	it('est livré refusé partout', () => {
		for (const n of NIVEAUX_DE_NOTE) expect(COEFFICIENTS_NOTE[n].accepte).toBe(false);
	});

	it('est exactement ce qu’écrit moduleDeCoefficients', async () => {
		const texte = await readFile(join(import.meta.dirname, '..', '..', 'src', 'domaine', 'coefficients-note.ts'), 'utf8');
		expect(moduleDeCoefficients(COEFFICIENTS_NOTE)).toBe(texte);
	});

	it('arrondit les nombres et ne garde aucun texte hors des refus', () => {
		const texte = moduleDeCoefficients({ ...COEFFICIENTS_NOTE, sens: { ...COEFFICIENTS_NOTE.sens, biais: -1.234567891234, poids: { cosinusRelatif: 12.3456789 } } });
		expect(texte).toContain('"biais": -1.23457');
		expect(texte).toContain('"cosinusRelatif": 12.3457');
	});
});
