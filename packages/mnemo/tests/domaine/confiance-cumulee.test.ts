import { describe, expect, it } from 'vitest';
import { ajouterSource, confianceCumulee } from '../../src/domaine/confiance-cumulee.ts';
import type { PartDeConfiance } from '../../src/domaine/confiance-cumulee.ts';

describe('confianceCumulee', () => {
	it('cumule deux sources indépendantes : 0,3 et 0,3 donnent 0,51', () => {
		expect(confianceCumulee([
			{ ref: 'sources/a.md', confiance: 0.3, type: 'inconnue' },
			{ ref: 'sources/b.md', confiance: 0.3, type: 'inconnue' },
		])).toBeCloseTo(0.51, 10);
	});

	it('ne compte qu\'une fois une même référence, avec sa meilleure confiance', () => {
		expect(confianceCumulee([
			{ ref: 'sources/a.md', confiance: 0.3, type: 'inconnue' },
			{ ref: 'sources/a.md', confiance: 0.3, type: 'inconnue' },
		])).toBeCloseTo(0.3, 10);
		expect(confianceCumulee([
			{ ref: 'sources/a.md', confiance: 0.3, type: 'inconnue' },
			{ ref: 'sources/a.md', confiance: 0.6, type: 'note' },
			{ ref: 'sources/b.md', confiance: 0.5, type: 'deduction' },
		])).toBeCloseTo(0.8, 10);
	});

	it('plafonne à 0,9 trois sources hautes', () => {
		expect(confianceCumulee([
			{ ref: 'a', confiance: 0.8, type: 'compte_rendu' },
			{ ref: 'b', confiance: 0.7, type: 'email' },
			{ ref: 'c', confiance: 0.9, type: 'spec_validee' },
		])).toBe(0.9);
	});

	it('dépasse 0,9 avec une source utilisateur ou contrat', () => {
		const autres = [{ ref: 'a', confiance: 0.8, type: 'compte_rendu' }, { ref: 'b', confiance: 0.7, type: 'email' }];
		expect(confianceCumulee([...autres, { ref: 'utilisateur', confiance: 0.7, type: 'utilisateur' }])).toBeCloseTo(0.982, 10);
		expect(confianceCumulee([...autres, { ref: 'c', confiance: 0.85, type: 'contrat' }])).toBeGreaterThan(0.9);
		expect(confianceCumulee([{ ref: 'u', confiance: 1, type: 'utilisateur' }, ...autres])).toBe(1);
	});

	it('une source seule garde sa confiance, même au-dessus du plafond', () => {
		expect(confianceCumulee([{ ref: 'a', confiance: 0.6, type: 'note' }])).toBe(0.6);
		expect(confianceCumulee([{ ref: 'a', confiance: 0.95, type: 'spec_validee' }])).toBe(0.95);
	});

	it('vaut 0 sans source', () => {
		expect(confianceCumulee([])).toBe(0);
	});
});

describe('ajouterSource', () => {
	it('cumule la nouvelle source avec la confiance actuelle', () => {
		expect(ajouterSource(0.3, { confiance: 0.3, type: 'inconnue' })).toBeCloseTo(0.51, 10);
		expect(ajouterSource(0, { confiance: 0.6, type: 'note' })).toBeCloseTo(0.6, 10);
	});

	it('plafonne à 0,9, sans descendre sous la confiance actuelle ni sous la nouvelle source', () => {
		expect(ajouterSource(0.8, { confiance: 0.7, type: 'email' })).toBe(0.9);
		expect(ajouterSource(0.9, { confiance: 0.3, type: 'inconnue' })).toBe(0.9);
	});

	it('dépasse 0,9 avec une source utilisateur ou contrat', () => {
		expect(ajouterSource(0.8, { confiance: 0.7, type: 'utilisateur' })).toBeCloseTo(0.94, 10);
		expect(ajouterSource(0.6, { confiance: 0.85, type: 'contrat' })).toBeCloseTo(0.94, 10);
		expect(ajouterSource(0.5, { confiance: 1, type: 'utilisateur' })).toBe(1);
	});

	it('dépasse 0,9 quand une source utilisateur ou contrat est déjà sur l\'information', () => {
		expect(ajouterSource(0.85, { confiance: 0.7, type: 'email' }, true)).toBeCloseTo(0.955, 10);
		expect(ajouterSource(0.85, { confiance: 0.7, type: 'email' })).toBe(0.9);
		expect(ajouterSource(0.85, { confiance: 0.7, type: 'email' }, true)).toBeCloseTo(confianceCumulee([
			{ ref: 'utilisateur', confiance: 0.85, type: 'utilisateur' },
			{ ref: 'sources/mail', confiance: 0.7, type: 'email' },
		]), 10);
	});

	it('dépasse 0,9 quand une source forte est déjà là ou arrive', () => {
		expect(ajouterSource(0.95, { confiance: 0.6, type: 'note' })).toBeCloseTo(0.98, 10);
		expect(ajouterSource(0.6, { confiance: 0.95, type: 'spec_validee' })).toBeCloseTo(0.98, 10);
	});

	it('source par source, donne la confiance cumulée de toutes les sources', () => {
		const cas: PartDeConfiance[][] = [
			[{ ref: 'a', confiance: 0.3, type: 'inconnue' }, { ref: 'b', confiance: 0.3, type: 'inconnue' }],
			[{ ref: 'a', confiance: 0.3, type: 'inconnue' }, { ref: 'b', confiance: 0.3, type: 'inconnue' }, { ref: 'c', confiance: 0.7, type: 'utilisateur' }],
			[{ ref: 'a', confiance: 0.8, type: 'compte_rendu' }, { ref: 'b', confiance: 0.7, type: 'email' }, { ref: 'c', confiance: 0.9, type: 'spec_validee' }],
			[{ ref: 'a', confiance: 0.5, type: 'deduction' }, { ref: 'b', confiance: 0.6, type: 'note' }, { ref: 'c', confiance: 0.7, type: 'utilisateur' }],
			[{ ref: 'a', confiance: 0.6, type: 'note' }, { ref: 'b', confiance: 0.95, type: 'spec_validee' }, { ref: 'c', confiance: 0.3, type: 'inconnue' }],
			[{ ref: 'a', confiance: 1, type: 'utilisateur' }, { ref: 'b', confiance: 0.6, type: 'note' }],
			[{ ref: 'a', confiance: 0.7, type: 'utilisateur' }, { ref: 'b', confiance: 0.8, type: 'compte_rendu' }, { ref: 'c', confiance: 0.7, type: 'email' }],
		];
		for (const parts of cas) {
			const pasAPas = parts.reduce((actuelle, p, i) => ajouterSource(actuelle, p, parts.slice(0, i).some((q) => ['utilisateur', 'contrat'].includes(q.type))), 0);
			expect(pasAPas).toBeCloseTo(confianceCumulee(parts), 10);
		}
	});
});
