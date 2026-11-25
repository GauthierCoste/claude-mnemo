import { describe, expect, it } from 'vitest';
import { DOCUMENT_RERANKER_MAX, REQUETE_RERANKER_MAX, requeteDuReranker, syntheseDuTexte, texteDuReranker } from '../../src/domaine/textes-du-reranker.ts';

describe('textes du reranker', () => {
	it('synthèse : ce qui suit la première ligne vide ; vide sans elle', () => {
		expect(syntheseDuTexte('Atelier Vitrail\n\nRestauration des vitraux.\nSuite.')).toBe('Restauration des vitraux.\nSuite.');
		expect(syntheseDuTexte('Atelier Vitrail')).toBe('');
	});

	it('texte d’une fiche : titre puis synthèse, coupé à la longueur commune', () => {
		expect(texteDuReranker('Atelier Vitrail', 'Atelier Vitrail\n\nRestauration des vitraux.')).toBe('Atelier Vitrail\nRestauration des vitraux.');
		const long = texteDuReranker('Corvel', `Corvel\n\n${'é'.repeat(5000)}`);
		expect([...long]).toHaveLength(DOCUMENT_RERANKER_MAX);
		expect(long.endsWith('…')).toBe(true);
	});

	it('requête : entière si elle tient ; sinon son début et sa fin (le message même d’une requête jointe)', () => {
		expect(requeteDuReranker('et pour le four ?')).toBe('et pour le four ?');
		const jointe = `${'a'.repeat(3000)}\net pour le four ?`;
		const coupee = requeteDuReranker(jointe);
		expect([...coupee]).toHaveLength(REQUETE_RERANKER_MAX);
		expect(coupee.startsWith('aaa')).toBe(true);
		expect(coupee.endsWith('et pour le four ?')).toBe(true);
		expect(coupee).toContain(' … ');
		// jamais au milieu d'un caractère de deux unités
		expect(requeteDuReranker('🪟'.repeat(2000))).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
	});

	it('requête et document tiennent ensemble dans un emplacement de 2 048 tokens, même à 2 caractères par token', () => {
		expect((REQUETE_RERANKER_MAX + DOCUMENT_RERANKER_MAX) / 2).toBeLessThan(2048);
	});
});
