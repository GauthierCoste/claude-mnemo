import { describe, expect, it } from 'vitest';
import { dossierDe, resumerFiche, texteBrut } from '../../src/memoire/resume-fiche.ts';

const corps = (lignes: string[]) => lignes.join('\n');

describe('resumerFiche : le résumé de l’aperçu', () => {
	it('synthèse : le texte avant la première section, en un paragraphe, sans le titre ; informations non barrées, les 3 premières', () => {
		const r = resumerFiche({
			type: 'sujet',
			corps: corps(['# Titre', '', 'Première phrase.', 'Seconde phrase.', '', '## Contexte', 'Pas dans la synthèse.', '', '## Informations', '- [regle] Un ^f-0001', '- ~~Barrée~~ ^f-0002', '- Deux | declare ^f-0003', '- Trois ^f-0004', '- Quatre ^f-0005']),
		});
		expect(r.synthese).toBe('Première phrase. Seconde phrase.');
		expect(r.informations).toEqual([
			{ texte: 'Un', categorie: 'regle', ancre: 'f-0001' },
			{ texte: 'Deux', categorie: null, ancre: 'f-0003' },
			{ texte: 'Trois', categorie: null, ancre: 'f-0004' },
		]);
		expect(r.total).toBe(4);
		expect(r.type).toBe('sujet');
	});

	it('l’information visée par la ligne passe en tête', () => {
		const r = resumerFiche({ type: 'sujet', corps: corps(['# T', '## Informations', '- Un ^f-0001', '- Deux ^f-0002', '- Trois ^f-0003', '- Quatre ^f-0004']) }, 'f-0004');
		expect(r.informations.map((i) => i.texte)).toEqual(['Quatre', 'Un', 'Deux']);
	});

	it('fiche vide : ni synthèse ni information ; `## Faits`, l’ancien titre, est lu', () => {
		expect(resumerFiche({ type: 'sujet', corps: '# T\n' })).toEqual({ type: 'sujet', synthese: '', informations: [], total: 0 });
		expect(resumerFiche({ type: 'sujet', corps: '## Faits\n- Ancien ^f-0001' }).total).toBe(1);
	});

	it('texte brut : liens, gras, italique et code perdent leurs marques ; dossier d’une fiche', () => {
		expect(texteBrut('Voir [[projets/a/Nom.md]], [[x|l’alias]], **gras**, *italique* et `code`.')).toBe('Voir Nom, l’alias, gras, italique et code.');
		expect(texteBrut('2 * 3 * 4')).toBe('2 * 3 * 4');
		expect(dossierDe('projets/a/Nom.md')).toBe('projets/a');
		expect(dossierDe('Nom.md')).toBe('');
	});
});
