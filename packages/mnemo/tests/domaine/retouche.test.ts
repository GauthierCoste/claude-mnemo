import { describe, expect, it } from 'vitest';
import { distanceDEdition, distancePermise, DISTANCE_MAX_RETOUCHE, retoucheDeSens } from '../../src/domaine/retouche.ts';

const ENJEU = ['montant', 'echeance', 'perimetre'];
const retouche = (avant: string, apres: string) => retoucheDeSens({ texte: avant }, { texte: apres }, ENJEU);

describe('retoucheDeSens', () => {
	it('laisse passer une retouche de forme : coquille, lettre d\'un nom, accents, ponctuation, casse, séparateur de milliers', () => {
		expect(retouche('Le client s\'appelle Corbano', 'Le client s\'appelle Cordano')).toBeNull();
		expect(retouche('Le cleint signe en mars', 'Le client signe en mars')).toBeNull();
		expect(retouche('Reunion prevue a Lyon', 'Réunion prévue à Lyon')).toBeNull();
		expect(retouche('acme est un client fidèle', 'Acme est un client fidèle.')).toBeNull();
		expect(retouche('Budget de 1 200 € HT', 'Budget de 1200 € HT')).toBeNull();
		expect(retouche('Taux de 1,5 %', 'Taux de 1.5 %')).toBeNull();
		expect(retouche('Livré le 03/11', 'Livré le 3/11')).toBeNull();
	});

	it('refuse un nombre, un montant, une date, une durée ou une négation changés', () => {
		for (const [avant, apres] of [
			['Budget de 1200 €', 'Budget de 1300 €'],
			['Budget de 1200 €', 'Budget de 1200 $'],
			['Budget de 1200 €', 'Budget de 1200'],
			['Remise de 10 %', 'Remise de 10'],
			['Réunion le 24 novembre', 'Réunion le 24 décembre'],
			['Livré le 2026-11-24', 'Livré le 2026-11-25'],
			['Livraison en 3 jours', 'Livraison en 3 semaines'],
			['Livraison en trois jours', 'Livraison en quatre jours'],
			['Acme est un client', 'Acme n\'est pas un client'],
			['Deux lots livrés', 'Deux lots livrés en 2026'],
			['Livré le 2026-03-04', 'Livré le 2026-04-03'],
			['Lot A à 400 €, lot B à 600 €', 'Lot A à 600 €, lot B à 400 €'],
			['Budget de 1,2 M€', 'Budget de 1,2 €'],
			['Paiement avant la livraison', 'Paiement après la livraison'],
			['Commande minimum de 10 lots', 'Commande maximum de 10 lots'],
			['Frais de port inclus', 'Frais de port exclus'],
			['Ouvert tous les jours', 'Ouvert tous les jours sauf lundi'],
		] as const) {
			const motif = retouche(avant, apres);
			expect(motif, `${avant} → ${apres}`).not.toBeNull();
			expect(motif).toContain('remplace');
		}
	});

	it('refuse un écart de texte au-delà d\'une correction de forme', () => {
		const motif = retouche('Le contact chez Acme est Marie Dupont', 'Le contact chez Acme est Jean-Pierre Martin');
		expect(motif).toContain('`proposer`');
		expect(motif).toContain('remplace');
		expect(retouche('Projet Alpha', 'Projet Gamma')).not.toBeNull();
	});

	it('catégorie : refusée si elle entre dans une catégorie à fort enjeu, en sort, ou passe de l\'une à l\'autre', () => {
		const texte = 'Paiement à réception';
		expect(retoucheDeSens({ texte, categorie: 'projet' }, { texte, categorie: 'client' }, ENJEU)).toBeNull();
		expect(retoucheDeSens({ texte }, { texte, categorie: 'client' }, ENJEU)).toBeNull();
		expect(retoucheDeSens({ texte, categorie: 'montant' }, { texte: 'Paiement à reception', categorie: 'montant' }, ENJEU)).toBeNull();
		for (const [avant, apres] of [
			[undefined, 'montant'],
			['projet', 'echeance'],
			['perimetre', 'projet'],
			['montant', undefined],
			['montant', 'echeance'],
		] as const) {
			const a = avant === undefined ? { texte } : { texte, categorie: avant };
			const b = apres === undefined ? { texte } : { texte, categorie: apres };
			expect(retoucheDeSens(a, b, ENJEU), `${avant} → ${apres}`).toContain('remplace');
		}
		// les catégories à fort enjeu sont celles du coffre
		expect(retoucheDeSens({ texte, categorie: 'projet' }, { texte, categorie: 'montant' }, ['budget'])).toBeNull();
	});
});

describe('distanceDEdition et distancePermise', () => {
	it('compte insertions, suppressions et substitutions ; s\'arrête au-delà du maximum', () => {
		expect(distanceDEdition('corbano', 'cordano')).toBe(1);
		expect(distanceDEdition('chat', 'chats')).toBe(1);
		expect(distanceDEdition('', 'abc')).toBe(3);
		expect(distanceDEdition('kitten', 'sitting')).toBe(3);
		expect(distanceDEdition('abcdefgh', 'zyxwvuts', 2)).toBe(3);
	});

	it('20 % de la longueur, au moins 2, au plus la constante', () => {
		expect(distancePermise(5)).toBe(2);
		expect(distancePermise(20)).toBe(4);
		expect(distancePermise(400)).toBe(DISTANCE_MAX_RETOUCHE);
	});
});
