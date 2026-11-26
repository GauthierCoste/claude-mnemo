import type { ChampReglageVue } from '@mnemo/contrat';
import { describe, expect, it } from 'vitest';
import { enSaisie, enValeur, modifications, valeurLisible } from '../../src/reglages/brouillon.ts';

const nombre: ChampReglageVue = { cle: 'contexte.similariteHooks', groupe: 'contexte', libelle: 'S', explication: 'e', genre: 'decimal', defaut: 0.55, valeur: 0.6, min: 0.1, max: 0.95, effet: 'immediat' };
const liste: ChampReglageVue = { cle: 'projets.marqueurs', groupe: 'projets', libelle: 'M', explication: 'e', genre: 'liste', defaut: ['.git'], valeur: ['.git'], effet: 'immediat' };

describe('brouillon des réglages', () => {
	it('nombre : virgule décimale admise ; illisible → le texte part tel quel (le service dira pourquoi)', () => {
		expect(enValeur(nombre, '0,7')).toBe(0.7);
		expect(enValeur(nombre, 'beaucoup')).toBe('beaucoup');
		expect(enValeur(nombre, '')).toBe('');
	});

	it('liste : virgules, espaces et vides retirés ; aller-retour', () => {
		expect(enValeur(liste, ' .git, , go.mod ')).toEqual(['.git', 'go.mod']);
		expect(enSaisie(liste, ['.git', 'go.mod'])).toBe('.git, go.mod');
	});

	it('modifications : seulement ce qui change ; revenu au défaut → null', () => {
		expect(modifications([nombre, liste], { 'contexte.similariteHooks': '0.6', 'projets.marqueurs': '.git' })).toEqual({});
		expect(modifications([nombre, liste], { 'contexte.similariteHooks': '0.55', 'projets.marqueurs': '.git, Makefile' })).toEqual({ 'contexte.similariteHooks': null, 'projets.marqueurs': ['.git', 'Makefile'] });
	});

	it('décimal : saisi et affiché avec une virgule, comme la ligne « Défaut » ; point et virgule acceptés', () => {
		expect(enSaisie(nombre, 0.45)).toBe('0,45');
		expect(valeurLisible(nombre, 0.45)).toBe('0,45');
		expect(enValeur(nombre, '0.7')).toBe(0.7);
		expect(enValeur(nombre, ' 0,7 ')).toBe(0.7);
		expect(modifications([nombre], { 'contexte.similariteHooks': '0,6' })).toEqual({});
		expect(valeurLisible({ ...liste, genre: 'entier' }, 4747)).toBe('4747');
	});

	it('valeur lisible : unité, « aucun »', () => {
		expect(valeurLisible({ ...liste, defaut: [] }, [])).toBe('aucun');
		expect(valeurLisible({ ...nombre, unite: 'minutes' }, 15)).toBe('15 minutes');
	});

	it('oui ou non : saisie « oui »/« non » (case à cocher), valeur booléenne, lisible en mots', () => {
		const automatique: ChampReglageVue = { cle: 'entrainement.automatique', groupe: 'entrainement', libelle: 'A', explication: 'e', genre: 'booleen', defaut: true, valeur: true, effet: 'immediat' };
		expect(enSaisie(automatique, true)).toBe('oui');
		expect(enSaisie(automatique, false)).toBe('non');
		expect(enValeur(automatique, 'non')).toBe(false);
		expect(valeurLisible(automatique, true)).toBe('oui');
		expect(modifications([automatique], { 'entrainement.automatique': 'non' })).toEqual({ 'entrainement.automatique': false });
		expect(modifications([{ ...automatique, valeur: false }], { 'entrainement.automatique': 'oui' })).toEqual({ 'entrainement.automatique': null });
	});
});
