import { describe, expect, it } from 'vitest';
import { fichesNommees, type Nommable } from '../../src/domaine/fiches-nommees.ts';

const nommables: Nommable[] = [
	{ chemin: 'a.md', titre: 'Solaire Eco Energie', alias: ['SVE'] },
	{ chemin: 'b.md', titre: 'Mnemo', alias: [] },
	{ chemin: 'c.md', titre: 'Documents', alias: [] },
	{ chemin: 'd.md', titre: 'ERP', alias: [] },
	{ chemin: 'e.md', titre: 'Majordome', alias: [] },
];

describe('fichesNommees', () => {
	it('trouve un titre malgré accents et tirets, dans l’ordre d’apparition', () => {
		expect(fichesNommees('Que sais-tu de Solaire Éco-Énergie et de Mnemo ?', nommables)).toEqual(['a.md', 'b.md']);
		expect(fichesNommees('Mnemo puis Solaire Eco Energie', nommables)).toEqual(['b.md', 'a.md']);
	});
	it('ignore le vocabulaire courant', () => {
		expect(fichesNommees('range les documents', nommables)).toEqual([]);
	});
	it('ignore un nom dont tous les mots sont du vocabulaire courant ou des mots vides', () => {
		const n: Nommable[] = [...nommables, { chemin: 'f.md', titre: 'Claude Code', alias: [] }, { chemin: 'g.md', titre: 'Claude Vela', alias: [] }];
		expect(fichesNommees('lance Claude Code', n)).toEqual([]);
		// « Vela » n'est le titre d'aucune autre fiche : seul le nom complet est trouvé
		expect(fichesNommees('lance Claude Vela', n)).toEqual(['g.md']);
	});
	it('ignore un nom de moins de 4 caractères, titre ou alias', () => {
		expect(fichesNommees('Maquette ERP', nommables)).toEqual([]);
		expect(fichesNommees('sve', nommables)).toEqual([]);
	});
	it('exige un mot entier', () => {
		expect(fichesNommees('les majordomes', nommables)).toEqual([]);
		expect(fichesNommees('Majordome, abandonné', nommables)).toEqual(['e.md']);
	});
	it('trouve une fiche par un alias assez long', () => {
		const n = [{ chemin: 'x.md', titre: 'Société anonyme', alias: ['Acme Corp'] }];
		expect(fichesNommees('Où en est acme-corp ?', n)).toEqual(['x.md']);
	});
	it('n’indique pas deux fois la même fiche', () => {
		expect(fichesNommees('Mnemo, encore Mnemo', nommables)).toEqual(['b.md']);
	});
	it('ne retient jamais un titre fait de mots vides', () => {
		const n = [{ chemin: 'v.md', titre: 'De la', alias: [] }, { chemin: 'w.md', titre: 'Pour tous', alias: [] }];
		expect(fichesNommees('Parle de la chose pour tous', n)).toEqual([]);
	});
});
