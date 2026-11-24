import { describe, expect, it } from 'vitest';
import { confiance, lireRegles, REGLES_PAR_DEFAUT } from '../../src/domaine/regles.ts';

describe('confiance', () => {
	it('pondère la fiabilité de la source par la nature', () => {
		expect(confiance(REGLES_PAR_DEFAUT, 'session', 'observe')).toBe(51);
		expect(confiance(REGLES_PAR_DEFAUT, 'utilisateur', 'declare')).toBe(100);
		expect(confiance(REGLES_PAR_DEFAUT, 'inconnue', 'infere')).toBe(21);
	});

	it('reste un entier entre 0 et 100', () => {
		const regles = { ...REGLES_PAR_DEFAUT, poids: { declare: 1, observe: 1, infere: 1 }, fiabilites: { ...REGLES_PAR_DEFAUT.fiabilites, note: 1 } };
		expect(confiance(regles, 'note', 'declare')).toBe(100);
	});
});

describe('lireRegles', () => {
	it('prend les défauts sur un en-tête vide, sans anomalie', () => {
		expect(lireRegles({})).toEqual(REGLES_PAR_DEFAUT);
		expect(REGLES_PAR_DEFAUT.anomalies).toEqual([]);
		expect(REGLES_PAR_DEFAUT.seuilRappel).toBe(0.4);
		expect(REGLES_PAR_DEFAUT.repetitionsPourMonter).toBe(2);
		expect(REGLES_PAR_DEFAUT.categoriesAEnjeu).toEqual(['montant', 'echeance', 'perimetre']);
		expect(REGLES_PAR_DEFAUT.fiabilites.inconnue).toBe(0.3);
	});

	it('une valeur hors [0,1] retombe sur le défaut avec une anomalie', () => {
		const regles = lireRegles({ poids_observe: 2 });
		expect(regles.poids.observe).toBe(0.85);
		expect(regles.anomalies).toHaveLength(1);
		expect(regles.anomalies[0]).toContain('poids_observe');
	});

	it('lit les fiabilités par type, les autres restent par défaut', () => {
		const regles = lireRegles({ fiabilites: { email: 0.5 } });
		expect(regles.fiabilites.email).toBe(0.5);
		expect(regles.fiabilites.note).toBe(0.6);
		expect(regles.anomalies).toEqual([]);
	});

	it('signale une fiabilité invalide en nommant le type, et ignore les clés inconnues', () => {
		const regles = lireRegles({ fiabilites: { email: 'haute', note: -1, inventee: 3 }, truc: 1 });
		expect(regles.fiabilites.email).toBe(0.7);
		expect(regles.anomalies).toHaveLength(2);
		expect(regles.anomalies[0]).toContain('fiabilites.email');
		expect(regles.anomalies[1]).toContain('fiabilites.note');
	});

	it('signale un bloc fiabilites qui n’est pas une table', () => {
		const regles = lireRegles({ fiabilites: [1] });
		expect(regles.anomalies[0]).toContain('fiabilites');
	});

	it('valide seuil_rappel, repetitions_pour_monter et categories_a_enjeu', () => {
		const bon = lireRegles({ seuil_rappel: 0.5, repetitions_pour_monter: 3, categories_a_enjeu: ['delai'] });
		expect(bon.seuilRappel).toBe(0.5);
		expect(bon.repetitionsPourMonter).toBe(3);
		expect(bon.categoriesAEnjeu).toEqual(['delai']);
		expect(bon.anomalies).toEqual([]);

		const mauvais = lireRegles({ seuil_rappel: 40, repetitions_pour_monter: 0, categories_a_enjeu: ['Montant'] });
		expect(mauvais.seuilRappel).toBe(0.4);
		expect(mauvais.repetitionsPourMonter).toBe(2);
		expect(mauvais.categoriesAEnjeu).toEqual(['montant', 'echeance', 'perimetre']);
		expect(mauvais.anomalies).toHaveLength(3);
		expect(lireRegles({ repetitions_pour_monter: 1.5 }).anomalies).toHaveLength(1);
		expect(lireRegles({ categories_a_enjeu: 'montant' }).anomalies).toHaveLength(1);
	});

	it('ne partage pas de tableau avec les défauts', () => {
		const regles = lireRegles({});
		regles.categoriesAEnjeu.push('x');
		expect(REGLES_PAR_DEFAUT.categoriesAEnjeu).toHaveLength(3);
	});
});
