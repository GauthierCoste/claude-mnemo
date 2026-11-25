import { describe, expect, it } from 'vitest';
import { deverrouiller, lieuDeclare, neutres, perimetreDe, TYPES_NON_PROPOSABLES, type Arete, type FicheDuGraphe } from '../../src/domaine/perimetre.ts';

const SVE = 'organisations/clients/SVE/SVE.md';
const OUTIL = 'organisations/clients/SVE/Outil Parcs.md';
const SOUS = 'organisations/clients/SVE/Sous/Sous.md';
const CORVEL = 'projets/clients/Corvel/Corvel.md';
const ERP = 'projets/clients/Corvel/ERP Corvelis.md';
const YSALINE = 'personnes/Ysaline.md';
const GIT = 'pratiques/Git.md';

const fiche = (chemin: string, typeFiche: string, declareUnLieu = false): FicheDuGraphe => ({ chemin, typeFiche, declareUnLieu });

const fiches: FicheDuGraphe[] = [
	fiche('organisations/clients/clients.md', 'dossier'),
	fiche(SVE, 'entite', true),
	fiche(OUTIL, 'entite'),
	fiche(SOUS, 'entite', true),
	fiche(CORVEL, 'entite', true),
	fiche(ERP, 'entite'),
	fiche(YSALINE, 'entite'),
	fiche(GIT, 'pratique'),
	fiche('sources/x/doc.md', 'source'),
];
const aretes: Arete[] = [
	{ de: SVE, vers: YSALINE },
	{ de: YSALINE, vers: ERP },
	{ de: SVE, vers: GIT },
];
const declarants = new Set(fiches.filter((f) => f.declareUnLieu).map((f) => f.chemin));

describe('lieuDeclare', () => {
	it('prend la fiche elle-même si elle déclare un lieu', () => {
		expect(lieuDeclare(SVE, declarants)).toBe(SVE);
	});
	it('remonte à la fiche de dossier déclarante la plus proche', () => {
		expect(lieuDeclare('organisations/clients/SVE/Sous/a.md', declarants)).toBe(SOUS);
		expect(lieuDeclare(OUTIL, declarants)).toBe(SVE);
	});
	it('rend null pour une fiche neutre', () => {
		expect(lieuDeclare(YSALINE, declarants)).toBeNull();
	});
});

describe('perimetreDe', () => {
	it("retient le rangement sous le dossier et les voisins à 1 ou 2 sauts, sans les fiches d'ailleurs", () => {
		const { dans, ailleurs } = perimetreDe(SVE, fiches, aretes);
		for (const c of [OUTIL, SOUS, YSALINE, GIT]) expect(dans.has(c)).toBe(true);
		expect(dans.has(ERP)).toBe(false);
		expect(ailleurs.has(ERP)).toBe(true);
		expect(ailleurs.has(CORVEL)).toBe(true);
		expect(ailleurs.has(YSALINE)).toBe(false);
		expect(ailleurs.has(GIT)).toBe(false);
	});
	it("un lien direct vers un lieu le fait cesser d'être d'ailleurs, avec ses fiches", () => {
		const { dans, ailleurs } = perimetreDe(SVE, fiches, [...aretes, { de: SVE, vers: CORVEL }]);
		expect(ailleurs.has(CORVEL)).toBe(false);
		expect(ailleurs.has(ERP)).toBe(false);
		expect(dans.has(CORVEL)).toBe(true);
	});
	it("une fiche reliée directement est du périmètre même si son lieu n'est pas relié", () => {
		const { dans, ailleurs } = perimetreDe(SVE, fiches, [...aretes, { de: SVE, vers: ERP }]);
		expect(dans.has(ERP)).toBe(true);
		expect(ailleurs.has(ERP)).toBe(false);
		expect(ailleurs.has(CORVEL)).toBe(true);
	});
	it('sans position : rien', () => {
		const { dans, ailleurs } = perimetreDe(null, fiches, aretes);
		expect(dans.size).toBe(0);
		expect(ailleurs.size).toBe(0);
	});
	it("une position qui est une fiche simple n'a pas de fiches rangées sous son dossier", () => {
		const simple = 'organisations/clients/Simple.md';
		const { dans } = perimetreDe(simple, [...fiches, fiche(simple, 'entite')], aretes);
		expect(dans.has(SVE)).toBe(false);
		expect(dans.has(OUTIL)).toBe(false);
		expect(dans.size).toBe(0);
	});
	it('les arêtes sont non orientées', () => {
		const { dans } = perimetreDe(YSALINE, fiches, aretes);
		expect(dans.has(SVE)).toBe(true);
		expect(dans.has(GIT)).toBe(true);
	});
	it("un ascendant de la position n'est pas d'ailleurs", () => {
		const { ailleurs } = perimetreDe(SOUS, fiches, aretes);
		expect(ailleurs.has(SVE)).toBe(false);
		expect(ailleurs.has(OUTIL)).toBe(false);
	});
});

describe('neutres', () => {
	it('les fiches sans lieu déclaré, hors du périmètre et d\'ailleurs (le type est filtré par l\'appelant)', () => {
		const neutresDeSVE = neutres(fiches, perimetreDe(SVE, fiches, aretes), declarants);
		expect([...neutresDeSVE].sort()).toEqual(['organisations/clients/clients.md', 'sources/x/doc.md']);
	});
	it('une fiche neutre du périmètre y reste : elle n\'est pas comptée deux fois', () => {
		const neutresDeSVE = neutres(fiches, perimetreDe(SVE, fiches, aretes), declarants);
		expect(neutresDeSVE.has(YSALINE)).toBe(false);
		expect(neutresDeSVE.has(GIT)).toBe(false);
	});
	it('à la racine : toutes les fiches sans lieu, aucune fiche rangée sous un lieu', () => {
		const aLaRacine = neutres(fiches, perimetreDe(null, fiches, aretes), declarants);
		expect([...aLaRacine].sort()).toEqual(['organisations/clients/clients.md', YSALINE, GIT, 'sources/x/doc.md'].sort());
		for (const c of [SVE, OUTIL, SOUS, CORVEL, ERP]) expect(aLaRacine.has(c)).toBe(false);
	});
});

describe('deverrouiller', () => {
	it('rend le lieu et les fiches qui en relèvent', () => {
		const ouvertes = deverrouiller([CORVEL], fiches, declarants);
		expect(ouvertes.has(CORVEL)).toBe(true);
		expect(ouvertes.has(ERP)).toBe(true);
		expect(ouvertes.has(SVE)).toBe(false);
	});
	it('prend toutes les fiches rangées sous le dossier du lieu, sous-lieux compris', () => {
		const profonde = 'organisations/clients/SVE/Sous/Profonde.md';
		const ouvertes = deverrouiller([SVE], [...fiches, fiche(profonde, 'entite')], declarants);
		expect(ouvertes.has(SVE)).toBe(true);
		expect(ouvertes.has(OUTIL)).toBe(true);
		expect(ouvertes.has(SOUS)).toBe(true);
		expect(ouvertes.has(profonde)).toBe(true);
		expect(ouvertes.has(CORVEL)).toBe(false);
	});
});

describe('TYPES_NON_PROPOSABLES', () => {
	it('liste les types jamais proposés', () => {
		expect([...TYPES_NON_PROPOSABLES].sort()).toEqual(['consigne', 'dossier', 'episode', 'profil', 'source']);
	});
});
