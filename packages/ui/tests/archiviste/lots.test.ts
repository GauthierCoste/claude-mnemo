import type { GenreLotVue, LigneDeLotVue, LotVue } from '@mnemo/contrat';
import { describe, expect, it } from 'vitest';
import { compteEnMots, compteLot, etiquetteLot, intituleLot, lireInformation, resumeChangement, texteInformation } from '../../src/archiviste/lots.ts';

const fusion = (indice: number, absorbees: number): LigneDeLotVue => ({
	indice,
	ligne: { garder: 'f-0001', absorber: Array.from({ length: absorbees }, (_, i) => `f-01${i}`) },
	avant: [],
	apres: null,
	motif: null,
});
const simple = (indice: number): LigneDeLotVue => ({ indice, ligne: { ancre: 'f-0001' }, avant: [], apres: null, motif: null });

const lot = (genre: GenreLotVue, lignes: LigneDeLotVue[], titre: string | null = 'Module stocks'): LotVue => ({
	id: 'l',
	genre,
	fiche: 'projets/erp-saas/Module stocks.md',
	titre,
	motif: '',
	proposeMs: 0,
	session: null,
	perime: false,
	lignes,
});

describe('intitulé et compte d’un lot', () => {
	it('fusion : les doublons sont les absorbées, toutes lignes confondues', () => {
		const l = lot('fusionner', [fusion(0, 1), fusion(1, 3), fusion(2, 1)]);
		expect(compteLot(l)).toBe(5);
		expect(intituleLot(l)).toBe('5 doublons proposés dans Module stocks');
		expect(compteLot(l, [0, 2])).toBe(2);
		expect(compteEnMots('fusionner', compteLot(l, [1]))).toBe('3 doublons');
		expect(intituleLot(lot('fusionner', [fusion(0, 1)]))).toBe('1 doublon proposé dans Module stocks');
	});

	it('fusion sans ligne proposée lisible : les visées moins la gardée', () => {
		const ligne: LigneDeLotVue = { indice: 0, ligne: { ancre: 'f-0001' }, avant: [{ ancre: 'a', lignes: [] }, { ancre: 'b', lignes: [] }, { ancre: 'c', lignes: [] }], apres: null, motif: null };
		expect(compteLot(lot('fusionner', [ligne]))).toBe(2);
	});

	it('suppression, confirmation : une par ligne, accordées', () => {
		expect(intituleLot(lot('supprimer', [simple(0), simple(1), simple(2), simple(3)]))).toBe('4 suppressions proposées dans Module stocks');
		expect(intituleLot(lot('confirmer', [simple(0)]))).toBe('1 confirmation proposée dans Module stocks');
		expect(compteEnMots('confirmer', 2)).toBe('2 lignes');
		expect(compteEnMots('supprimer', 1)).toBe('1 ligne');
	});

	it('sans titre du service : le titre tiré du chemin', () => {
		expect(intituleLot(lot('supprimer', [simple(0), simple(1)], null))).toBe('2 suppressions proposées dans Module stocks');
	});

	it('étiquette du genre', () => {
		expect([etiquetteLot('fusionner'), etiquetteLot('supprimer'), etiquetteLot('confirmer')]).toEqual(['Doublons', 'Suppressions', 'Confirmations']);
	});
});

describe('information du lot lue de ses lignes', () => {
	it('énoncé, catégorie, confiance, sources (la sienne puis les corroborations)', () => {
		const info = {
			ancre: 'f-0002',
			lignes: ['- [delai] Livraison au 15/12/2026. | observe | src: [[sources/cdc]] p.12 | confiance 80 % ^f-0002', '  > « citation »', '  + src: [[sources/mails]] 2026-11-05 | corroboré 2026-11-24'],
		};
		expect(lireInformation(info)).toEqual({ texte: 'Livraison au 15/12/2026.', categorie: 'delai', barre: false, confiance: 80, sources: ['[[sources/cdc]] p.12', '[[sources/mails]] 2026-11-05'] });
		expect(texteInformation(info)).toBe('Livraison au 15/12/2026.');
	});

	it('barrée ; sans champ ; absente', () => {
		expect(lireInformation({ ancre: 'f-0004', lignes: ['- [regle] ~~Les inventaires se font le lundi.~~ | observe | invalidé 2026-10-14 ^f-0004'] })).toMatchObject({ texte: 'Les inventaires se font le lundi.', barre: true, confiance: null });
		expect(texteInformation({ ancre: 'f-0009', lignes: ['- Texte seul ^f-0009'] })).toBe('Texte seul');
		expect(lireInformation({ ancre: 'f-0003', lignes: [] })).toBeNull();
		expect(texteInformation({ ancre: 'f-0003', lignes: [] })).toBe('f-0003 (absente)');
	});
});

describe('ce que change une ligne', () => {
	const ecrit = (texte: string, src: string, fin: string) => `- [decision] ${texte} | observe | src: ${src} | appris 2026-11-12 | ${fin} ^f-0001`;

	it('fusion : sources versées, confiance avant → après, absorbées', () => {
		const ligne: LigneDeLotVue = {
			indice: 0,
			ligne: { garder: 'f-0001', absorber: ['f-0006', 'f-0007'] },
			avant: [
				{ ancre: 'f-0001', lignes: [ecrit('Table stock_lot séparée.', '[[sources/cr]]', 'confiance 30 %')] },
				{ ancre: 'f-0006', lignes: [ecrit('Une table stock_lot porte les lots.', '[[sources/cdc]] p.4', 'confiance 80 %')] },
				{ ancre: 'f-0007', lignes: [ecrit('stock_lot à part.', 'session 7f3a', 'confiance 40 %')] },
			],
			apres: {
				ancre: 'f-0001',
				lignes: [ecrit('Table stock_lot séparée.', '[[sources/cr]]', 'confiance 51 %'), '  + src: [[sources/cdc]] p.4 | corroboré 2026-11-24', '  + src: session 7f3a | corroboré 2026-11-24'],
			},
			motif: null,
		};
		expect(resumeChangement(ligne, 'fusionner')).toEqual(['+ sources [[sources/cdc]] p.4, session 7f3a · confiance 30 % → 51 %', 'absorbe : « Une table stock_lot porte les lots. », « stock_lot à part. »']);
	});

	it('fusion : une seule source nouvelle ; aucune (déjà présente) et confiance inchangée', () => {
		const gardee = { ancre: 'f-0001', lignes: [ecrit('A.', '[[sources/cr]]', 'confiance 60 %')] };
		const absorbee = { ancre: 'f-0002', lignes: [ecrit('A bis.', '[[sources/cdc]]', 'confiance 60 %')] };
		const une: LigneDeLotVue = { indice: 0, ligne: { garder: 'f-0001', absorber: ['f-0002'] }, avant: [gardee, absorbee], apres: { ancre: 'f-0001', lignes: [ecrit('A.', '[[sources/cr]]', 'confiance 84 %'), '  + src: [[sources/cdc]] | corroboré 2026-11-24'] }, motif: null };
		expect(resumeChangement(une, 'fusionner')[0]).toBe('+ source [[sources/cdc]] · confiance 60 % → 84 %');
		const aucune: LigneDeLotVue = { ...une, apres: gardee };
		expect(resumeChangement(aucune, 'fusionner')).toEqual(['aucune source nouvelle', 'absorbe : « A bis. »']);
	});

	it('suppression : « supprimée » ; confirmation : « confirmée », et la confiance si elle change', () => {
		const avant = { ancre: 'f-0001', lignes: ['- [decision] D. | infere | src: session c21e | a confirmer ^f-0001'] };
		expect(resumeChangement({ indice: 0, ligne: { ancre: 'f-0001' }, avant: [avant], apres: null, motif: null }, 'supprimer')).toEqual(['supprimée']);
		const confirmee = { ancre: 'f-0001', lignes: ['- [decision] D. | infere | src: session c21e | confiance 70 % ^f-0001'] };
		expect(resumeChangement({ indice: 0, ligne: { ancre: 'f-0001' }, avant: [avant], apres: confirmee, motif: null }, 'confirmer')).toEqual(['confirmée · confiance 70 %']);
		expect(resumeChangement({ indice: 0, ligne: { ancre: 'f-0001' }, avant: [confirmee], apres: confirmee, motif: null }, 'confirmer')).toEqual(['confirmée']);
	});
});
