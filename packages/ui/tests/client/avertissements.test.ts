import { describe, expect, it } from 'vitest';
import { lignesAvertissements } from '../../src/client/avertissements.ts';

describe('avertissements d’une écriture faite', () => {
	it('une ligne par avertissement ; sans avertissement : aucune', () => {
		expect(lignesAvertissements({ avertissements: ['index en panne', 'extraction incomplète'] })).toEqual(['Avertissement : index en panne', 'Avertissement : extraction incomplète']);
		expect(lignesAvertissements({})).toEqual([]);
	});
});
