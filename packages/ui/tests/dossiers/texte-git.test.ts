import { describe, expect, it } from 'vitest';
import { texteGit } from '../../src/composants/commun/ArbreDossiers.tsx';

describe('texteGit', () => {
	it('la branche est affichée quel que soit son nom (main compris), à jour ou non ; détachée : sans branche ; hors dépôt : rien', () => {
		expect(texteGit({ branche: 'main', fichiers: [], modifies: 2 })).toBe('main | 2 modif.');
		expect(texteGit({ branche: 'master', fichiers: [], modifies: 2 })).toBe('master | 2 modif.');
		expect(texteGit({ branche: 'main', fichiers: [], modifies: 0 })).toBe('main | à jour');
		expect(texteGit({ branche: null, fichiers: [], modifies: 0 })).toBe('à jour');
		expect(texteGit(null)).toBeNull();
		expect(texteGit(undefined)).toBeNull();
	});
});
