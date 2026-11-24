import { describe, expect, it } from 'vitest';
import { arbitrer, doitEtreConfirme } from '../../src/domaine/arbitrage.ts';
import type { Candidat, Existant } from '../../src/domaine/arbitrage.ts';
import type { Fait } from '../../src/domaine/fait.ts';
import { REGLES_PAR_DEFAUT } from '../../src/domaine/regles.ts';
import type { TypeSource } from '../../src/domaine/regles.ts';

function fait(texte: string, autres: Partial<Fait> = {}): Fait {
	return { texte, finIncluse: false, aConfirmer: false, barre: false, ...autres };
}

function candidat(texte: string, typeSource: TypeSource, date: string, autres: Partial<Candidat> = {}, faitAutres: Partial<Fait> = {}): Candidat {
	return { fait: fait(texte, faitAutres), typeSource, remplaceExplicitement: false, date, ...autres };
}

function existant(texte: string, typeSource: TypeSource, date: string): Existant {
	return { fait: fait(texte), typeSource, date };
}

describe('arbitrer', () => {
	it('ajoute quand il n’y a pas d’existant', () => {
		expect(arbitrer(REGLES_PAR_DEFAUT, candidat('Budget 10 k€', 'email', '2026-11-20'))).toBe('ajouter');
	});

	it('doublon quand l’énoncé est le même, même si la source est plus fiable', () => {
		expect(arbitrer(REGLES_PAR_DEFAUT, candidat('Budget 10 k€', 'utilisateur', '2026-11-20'), existant('Budget 10 k€', 'note', '2026-10-01'))).toBe('doublon');
	});

	it('remplace quand le remplacement est explicite, avec une source au moins aussi fiable', () => {
		const c = candidat('Budget 12 k€', 'email', '2026-10-01', { remplaceExplicitement: true });
		expect(arbitrer(REGLES_PAR_DEFAUT, c, existant('Budget 10 k€', 'email', '2026-11-20'))).toBe('remplacer');
		const u = candidat('Budget 12 k€', 'utilisateur', '2026-10-01', { remplaceExplicitement: true });
		expect(arbitrer(REGLES_PAR_DEFAUT, u, existant('Budget 10 k€', 'contrat', '2026-11-20'))).toBe('remplacer');
	});

	it('remplacement explicite par une source moins fiable : contradiction, à confirmer par l’humain', () => {
		const c = candidat('Budget 12 k€', 'session', '2026-12-01', { remplaceExplicitement: true });
		const d = arbitrer(REGLES_PAR_DEFAUT, c, existant('Budget 10 k€', 'utilisateur', '2026-11-20'));
		expect(d).toBe('contradiction');
		expect(doitEtreConfirme(REGLES_PAR_DEFAUT, c, d)).toBe(true);
	});

	it('remplace quand la source est plus fiable', () => {
		expect(arbitrer(REGLES_PAR_DEFAUT, candidat('Budget 12 k€', 'contrat', '2026-09-01'), existant('Budget 10 k€', 'email', '2026-11-20'))).toBe('remplacer');
	});

	it('à fiabilité égale, remplace par la plus récente', () => {
		expect(arbitrer(REGLES_PAR_DEFAUT, candidat('Budget 12 k€', 'email', '2026-11-20'), existant('Budget 10 k€', 'email', '2026-10-01'))).toBe('remplacer');
	});

	it('contradiction quand la source est moins fiable mais plus récente', () => {
		expect(arbitrer(REGLES_PAR_DEFAUT, candidat('Budget 12 k€', 'email', '2026-11-20'), existant('Budget 10 k€', 'spec_validee', '2026-10-01'))).toBe('contradiction');
	});

	it('doublon (rien à écrire) quand la source est moins fiable et plus ancienne', () => {
		expect(arbitrer(REGLES_PAR_DEFAUT, candidat('Budget 12 k€', 'email', '2026-09-01'), existant('Budget 10 k€', 'spec_validee', '2026-10-01'))).toBe('doublon');
	});
});

describe('doitEtreConfirme', () => {
	it('vrai pour une contradiction', () => {
		expect(doitEtreConfirme(REGLES_PAR_DEFAUT, candidat('x', 'email', '2026-11-20'), 'contradiction')).toBe(true);
	});

	it('vrai pour un fait inféré', () => {
		expect(doitEtreConfirme(REGLES_PAR_DEFAUT, candidat('x', 'note', '2026-11-20', {}, { nature: 'infere' }), 'ajouter')).toBe(true);
	});

	it('vrai pour une catégorie à enjeu comme [montant]', () => {
		expect(doitEtreConfirme(REGLES_PAR_DEFAUT, candidat('12 k€', 'note', '2026-11-20', {}, { categorie: 'montant' }), 'ajouter')).toBe(true);
	});

	it('faux pour un fait observé ordinaire', () => {
		expect(doitEtreConfirme(REGLES_PAR_DEFAUT, candidat('x', 'note', '2026-11-20', {}, { nature: 'observe', categorie: 'contact' }), 'ajouter')).toBe(false);
	});
});
