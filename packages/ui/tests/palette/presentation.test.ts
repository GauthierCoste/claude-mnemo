import { describe, expect, it } from 'vitest';
import { cheminCourt, corpsDe, extrait, libelleGenre, surligner, titreDe } from '../../src/palette/presentation.ts';

const marques = (segments: { texte: string; surligne: boolean }[]) => segments.filter((x) => x.surligne).map((x) => x.texte);

describe('palette : présentation d’un résultat', () => {
	it('surligne le début des mots cherchés, sans accents ni casse, et les formes à une terminaison près', () => {
		expect(marques(surligner('Le Stock des Lots ; stockage', ['stocks', 'lot']))).toEqual(['Stock', 'Lot']);
		expect(marques(surligner('stockage', ['stoc']))).toEqual(['stoc']);
		expect(marques(surligner('Échéance décidée', ['echeance']))).toEqual(['Échéance']);
		expect(surligner('<img src=x onerror=alert(1)>', ['img']).map((x) => x.texte).join('')).toBe('<img src=x onerror=alert(1)>');
	});

	it('extrait autour du premier mot trouvé, coupé sur un mot, « … » aux coupures', () => {
		const texte = `${'mot '.repeat(30)}la gestion des stocks par lot ${'fin '.repeat(60)}`;
		const segments = extrait(texte, ['stocks'], 80);
		const plat = segments.map((x) => x.texte).join('');
		expect(plat.startsWith('…')).toBe(true);
		expect(plat.endsWith('…')).toBe(true);
		expect(plat).toContain('la gestion des stocks');
		expect(marques(segments)).toEqual(['stocks']);
		expect(extrait('court', ['absent'])).toEqual([{ texte: 'court', surligne: false }]);
		expect(extrait('', ['x'])).toEqual([]);
	});

	it('titre, corps, genre et chemin court', () => {
		const fiche = { genre: 'fiche' as const, chemin: 'projets/erp/Module.md', texte: 'Module stocks\n\nSynthèse  du module.', contexte: 'projets › erp › Module stocks', typeFiche: 'sujet' };
		expect(titreDe(fiche)).toBe('Module stocks');
		expect(corpsDe(fiche)).toBe('Synthèse du module.');
		const fait = { ...fiche, genre: 'fait' as const, texte: 'Un fait.' };
		expect(titreDe(fait)).toBe('Module stocks');
		expect(corpsDe(fait)).toBe('Un fait.');
		expect(titreDe({ ...fait, contexte: '' })).toBe('Module');
		expect(libelleGenre(fait)).toBe('Information');
		expect(libelleGenre({ genre: 'fiche', chemin: 'sources/cdc.md', typeFiche: 'source' })).toBe('Document');
		expect(libelleGenre({ genre: 'passage', chemin: 'sources/cdc.md', typeFiche: 'source' })).toBe('Passage de document');
		expect(cheminCourt('Racine.md')).toBe('racine');
		expect(cheminCourt('projets/erp/Module.md')).toBe('projets/erp');
		expect(cheminCourt('a/b/c/d/e.md#^f-0001')).toBe('…/c/d');
	});
});
