import { describe, expect, it } from 'vitest';
import { ecrireFait, faitsEgaux, lignesDuFait, lireFait, memeEnonce } from '../../src/domaine/fait.ts';

const LIGNE_COMPLETE = '- [delai] Livraison du module stocks au 15/12/2026. | observe | src: [[sources/cdc-stocks-v3]] p.12 | appris 2026-11-20 | valide [2026-11-20,) | confiance 80 % ^f-0031';
const CITATION = '  > « La livraison du module stocks est fixée au 15 décembre 2026, recette incluse. »';

describe('lireFait', () => {
	it("lit le fait complet de l'exemple du format", () => {
		const fait = lireFait(LIGNE_COMPLETE, CITATION);
		expect(fait).not.toBeNull();
		expect(fait?.texte).toBe('Livraison du module stocks au 15/12/2026.');
		expect(fait?.categorie).toBe('delai');
		expect(fait?.nature).toBe('observe');
		expect(fait?.source).toBe('[[sources/cdc-stocks-v3]] p.12');
		expect(fait?.appris).toBe('2026-11-20');
		expect(fait?.valideDebut).toBe('2026-11-20');
		expect(fait?.valideFin).toBeUndefined();
		expect(fait?.finIncluse).toBe(false);
		expect(fait?.confiance).toBe(80);
		expect(fait?.aConfirmer).toBe(false);
		expect(fait?.barre).toBe(false);
		expect(fait?.ancre).toBe('f-0031');
		expect(fait?.citation).toBe('La livraison du module stocks est fixée au 15 décembre 2026, recette incluse.');
	});

	it('accepte les mentions dans un ordre quelconque', () => {
		const fait = lireFait('- Un fait. | confiance 50 % | a confirmer | infere | appris 2026-01-02');
		expect(fait).toMatchObject({ confiance: 50, aConfirmer: true, nature: 'infere', appris: '2026-01-02' });
	});

	it('ignore une ligne suivante qui nest pas une citation', () => {
		expect(lireFait(LIGNE_COMPLETE, '- autre fait')?.citation).toBeUndefined();
	});

	it("lit l'invalidation avec son renvoi sans ancre", () => {
		const fait = lireFait('- ~~Un fait.~~ | invalidé 2026-10-14 par ^f-0040');
		expect(fait).toMatchObject({ barre: true, invalideLe: '2026-10-14', invalidePar: 'f-0040' });
		expect(fait?.ancre).toBeUndefined();
	});
});

describe('aller-retour', () => {
	const exemples: string[][] = [
		[LIGNE_COMPLETE, CITATION],
		['- [regle] ~~Les inventaires se font le lundi.~~ | observe | src: [[sources/fil-inventaires]] 2026-09-02 | invalidé 2026-10-14 par ^f-0040 ^f-0018'],
		['- [montant] Le forfait est de 4 000 euros. | declare | src: utilisateur | a confirmer ^f-0002'],
		['- Contrat actif. | valide [2026-01-01,2026-12-31] ^f-0003'],
		['- Un fait sans catégorie. | infere | src: [[a|b]] ^f-0004'],
		['- Un fait nu.'],
	];
	for (const lignes of exemples) {
		it(lignes[0]!, () => {
			const fait = lireFait(lignes[0]!, lignes[1]);
			expect(fait).not.toBeNull();
			expect(ecrireFait(fait!)).toEqual(lignes);
		});
	}

	it('écrit les mentions dans lordre normatif', () => {
		const lignes = ecrireFait({
			texte: 'T.', nature: 'declare', source: 's', appris: '2026-01-01', valideDebut: '2026-01-01', finIncluse: false,
			confiance: 10, aConfirmer: true, barre: false, invalideLe: '2026-02-02', ancre: 'f-0001',
		});
		expect(lignes).toEqual(['- T. | declare | src: s | appris 2026-01-01 | valide [2026-01-01,) | confiance 10 % | a confirmer | invalidé 2026-02-02 ^f-0001']);
	});
});

describe('refuse', () => {
	const refus: Record<string, string> = {
		'mention inconnue': '- Un fait. | bizarre',
		'mention en double': '- Un fait. | observe | declare',
		'source en double': '- Un fait. | src: a | src: b',
		'confiance hors bornes': '- Un fait. | confiance 120 %',
		'énoncé vide': '- | observe',
		'énoncé vide avec catégorie': '- [delai]  | observe',
		'rature au milieu': '- Un ~~fait~~ barré. | observe',
		'sans tiret': 'Un fait. | observe',
		'validité vide': '- Un fait. | valide [,)',
	};
	for (const [nom, ligne] of Object.entries(refus)) {
		it(nom, () => expect(lireFait(ligne)).toBeNull());
	}
});

describe('memeEnonce', () => {
	const lire = (l: string) => lireFait(l)!;

	it('ignore mentions, rature, espaces multiples et cibles de liens', () => {
		const a = lire('- [delai] Voir [[sources/a]]  pour le  détail. | observe | src: x ^f-0001');
		const b = lire('- [delai] ~~Voir [[sources/b|alias]] pour le détail.~~ | declare | invalidé 2026-01-01');
		expect(memeEnonce(a, b)).toBe(true);
	});

	it('distingue la catégorie', () => {
		expect(memeEnonce(lire('- [delai] X.'), lire('- [regle] X.'))).toBe(false);
		expect(memeEnonce(lire('- [delai] X.'), lire('- X.'))).toBe(false);
	});

	it('distingue la validité', () => {
		expect(memeEnonce(lire('- X. | valide [2026-01-01,)'), lire('- X. | valide [2026-01-02,)'))).toBe(false);
		expect(memeEnonce(lire('- X. | valide [2026-01-01,2026-02-01)'), lire('- X. | valide [2026-01-01,2026-02-01]'))).toBe(false);
		expect(memeEnonce(lire('- X. | valide [2026-01-01,)'), lire('- X.'))).toBe(false);
	});
});

describe('faitsEgaux', () => {
	const base = { texte: 'a', finIncluse: false, aConfirmer: false, barre: false };
	it('compare champ à champ', () => {
		expect(faitsEgaux({ ...base }, { ...base })).toBe(true);
		expect(faitsEgaux({ ...base, categorie: undefined }, { ...base })).toBe(true);
		expect(faitsEgaux({ ...base, confiance: 50 }, { ...base })).toBe(false);
		expect(faitsEgaux({ ...base, citation: 'x' }, { ...base, citation: 'y' })).toBe(false);
		expect(faitsEgaux(null, { ...base })).toBe(false);
		expect(faitsEgaux(null, null)).toBe(true);
	});
});

describe('mention contredit', () => {
	const LIGNE = '- Paiement à 45 jours | declare | src: [[sources/mail]] | appris 2026-11-22 | confiance 70 % | a confirmer | contredit ^f-0001 ^f-0002';

	it('se lit et se réécrit à l\'identique, juste après « a confirmer »', () => {
		const fait = lireFait(LIGNE);
		expect(fait).toMatchObject({ aConfirmer: true, contredit: 'f-0001', ancre: 'f-0002' });
		expect(ecrireFait(fait!)).toEqual([LIGNE]);
	});

	it('n\'est pas prise pour l\'ancre en fin de ligne', () => {
		expect(lireFait('- X | contredit ^f-0001')).toMatchObject({ contredit: 'f-0001' });
		expect(lireFait('- X | contredit ^f-0001')?.ancre).toBeUndefined();
	});

	it('reste après la confirmation, et compte dans l\'égalité', () => {
		const fait = lireFait(LIGNE)!;
		fait.aConfirmer = false;
		expect(ecrireFait(fait)).toEqual([LIGNE.replace(' | a confirmer', '')]);
		expect(faitsEgaux(lireFait(LIGNE), lireFait(LIGNE.replace('f-0001', 'f-0003')))).toBe(false);
	});

	it('rejette une cible mal formée ou une mention en double', () => {
		expect(lireFait('- X | contredit f-0001 ^f-0002')).toBeNull();
		expect(lireFait('- X | contredit ^f-0001 | contredit ^f-0003 ^f-0002')).toBeNull();
	});
});

describe('corroborations', () => {
	const LIGNES = [
		'- [delai] Livraison au 15/12. | declare | src: [[sources/a]] | appris 2026-11-22 | confiance 51 % ^f-0012',
		'  > « citation de la source a »',
		'  + src: [[sources/b]] | corroboré 2026-11-24',
		'  > « citation de la source b »',
		'  + src: [[sources/c]] p.3 | corroboré 2026-11-25',
	];

	it('se lisent sous l\'information, avec et sans citation', () => {
		const fait = lireFait(LIGNES[0]!, ...LIGNES.slice(1));
		expect(fait?.citation).toBe('citation de la source a');
		expect(fait?.corroborations).toEqual([
			{ source: '[[sources/b]]', le: '2026-11-24', citation: 'citation de la source b' },
			{ source: '[[sources/c]] p.3', le: '2026-11-25' },
		]);
		expect(lignesDuFait(fait!)).toBe(5);
	});

	it('se relisent et se réécrivent à l\'identique', () => {
		expect(ecrireFait(lireFait(LIGNES[0]!, ...LIGNES.slice(1))!)).toEqual(LIGNES);
	});

	it('se lisent aussi sans citation de la première source', () => {
		const lignes = [LIGNES[0]!, LIGNES[2]!, LIGNES[3]!];
		const fait = lireFait(lignes[0]!, ...lignes.slice(1));
		expect(fait?.citation).toBeUndefined();
		expect(fait?.corroborations).toHaveLength(1);
		expect(ecrireFait(fait!)).toEqual(lignes);
	});

	it('s\'arrêtent à la première ligne qui n\'en est pas une', () => {
		const fait = lireFait(LIGNES[0]!, LIGNES[1], '- Autre fait.', LIGNES[2]);
		expect(fait?.corroborations).toBeUndefined();
		expect(lignesDuFait(fait!)).toBe(2);
	});

	it('refusent une ligne mal formée, qui n\'appartient alors pas au fait', () => {
		for (const ligne of ['  + src: [[sources/b]] | corroboré 24/11/2026', '  + src: a | b | corroboré 2026-11-24', '  + [[sources/b]] | corroboré 2026-11-24']) {
			expect(lireFait(LIGNES[0]!, ligne)?.corroborations).toBeUndefined();
		}
	});

	it('une information sans corroboration s\'écrit comme avant', () => {
		const fait = lireFait(LIGNE_COMPLETE, CITATION)!;
		expect(fait.corroborations).toBeUndefined();
		expect(ecrireFait({ ...fait, corroborations: [] })).toEqual([LIGNE_COMPLETE, CITATION]);
	});

	it('comptent dans l\'égalité', () => {
		const fait = lireFait(LIGNES[0]!, ...LIGNES.slice(1))!;
		expect(faitsEgaux(fait, lireFait(LIGNES[0]!, ...LIGNES.slice(1)))).toBe(true);
		expect(faitsEgaux(fait, lireFait(LIGNES[0]!, ...LIGNES.slice(1, 4)))).toBe(false);
		expect(faitsEgaux(fait, lireFait(LIGNES[0]!, ...LIGNES.slice(1, 4), LIGNES[4]!.replace('p.3', 'p.4')))).toBe(false);
		expect(faitsEgaux(lireFait(LIGNE_COMPLETE)!, { ...lireFait(LIGNE_COMPLETE)!, corroborations: [] })).toBe(true);
	});
});
