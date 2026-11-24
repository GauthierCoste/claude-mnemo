import { describe, expect, it } from 'vitest';
import { avecAvertissements, avertissementsDe, ligneAvertissement } from '../src/avertissements.ts';

describe('avertissements : une définition pour le champ, sa copie et sa ligne', () => {
	it('liste vide : champ absent ; sinon la liste', () => {
		expect(avecAvertissements([])).toEqual({});
		expect(avecAvertissements(['a'])).toEqual({ avertissements: ['a'] });
	});

	it('copie depuis un résultat de n’importe quel genre (refus sans champ, liste vide, liste)', () => {
		type Resultat = { statut: 'refuse'; motif: string } | { statut: 'ecrit'; avertissements?: string[] };
		const refus = ((): Resultat => ({ statut: 'refuse', motif: 'x' }))();
		expect(avertissementsDe(refus)).toEqual({});
		// @ts-expect-error un champ mal nommé ne passe pas
		avertissementsDe({ chemin: 'a.md', avis: ['x'] });
		expect(avertissementsDe({ statut: 'ecrit', avertissements: [] })).toEqual({});
		expect(avertissementsDe({ statut: 'ecrit', avertissements: ['index en panne'] })).toEqual({ avertissements: ['index en panne'] });
	});

	it('ligne montrée à une personne', () => {
		expect(ligneAvertissement('index en panne')).toBe('Avertissement : index en panne');
	});
});
