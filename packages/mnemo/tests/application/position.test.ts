import { describe, expect, it } from 'vitest';
import { positionDuProjet, positionValide } from '../../src/application/position.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const fiche = (extra = '', type = 'dossier') => `---\nid: 01ABC\ntype: ${type}\n${extra}updated: 2026-11-01\n---\n# T\n\nSynthèse.\n`;
const couvert = (chemin: string, dossier: string) => ({ chemin, rattachement: { dossier, rattache: true } });
const nonRattache = (dossier: string) => ({ chemin: '', rattachement: { dossier, rattache: false } });

describe('positionDuProjet', () => {
	it('dossier_projet déclaré par une fiche de dossier : la position est le dossier, y compris depuis un sous-dossier', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('g1/d1/d1.md', fiche('dossier_projet: h1\n'));
		expect(await positionDuProjet(dep, 'h1/e1')).toEqual(couvert('g1/d1', 'h1/e1'));
		expect(await positionDuProjet(dep, 'h1')).toEqual(couvert('g1/d1', 'h1'));
		// frontière de dossier : « h1x » n'est pas sous « h1 »
		expect(await positionDuProjet(dep, 'h1x')).toEqual(nonRattache('h1x'));
	});

	it('la déclaration la plus longue gagne ; une fiche simple donne son chemin', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('g1/d1/d1.md', fiche('dossier_projet: h1\n'));
		await dep.coffre.ecrire('g1/f1.md', fiche('dossier_projet: h1/e1\n', 'entite'));
		expect(await positionDuProjet(dep, 'h1/e1/i1')).toEqual(couvert('g1/f1.md', 'h1/e1/i1'));
		expect(await positionDuProjet(dep, 'h1/e2')).toEqual(couvert('g1/d1', 'h1/e2'));
	});

	it('une fiche qui n’est pas un lieu (source, épisode) ne rattache rien', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('g1/d1/d1.md', fiche('dossier_projet: h1\n', 'source'));
		expect(await positionDuProjet(dep, 'h1')).toEqual(nonRattache('h1'));
	});

	it('séparateurs Windows et « / » final : normalisés', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('g1/d1/d1.md', fiche('dossier_projet: h1\n'));
		expect(await positionDuProjet(dep, 'h1\\e1\\')).toEqual(couvert('g1/d1', 'h1/e1'));
	});

	it('racine du dossier Mnemo ou chemin invalide : la racine, rien à rattacher', async () => {
		const dep = fauxPorts();
		expect(await positionDuProjet(dep, '')).toEqual({ chemin: '', rattachement: null });
		expect(await positionDuProjet(dep, '../h1')).toEqual({ chemin: '', rattachement: null });
	});
});

describe('positionDuProjet : le lien est posé par une fiche, jamais tiré des noms', () => {
	it('un dossier de la mémoire du même nom que le dossier de projet ne le couvre pas : racine, dossier non rattaché', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('g1/d1/d1.md', fiche());
		await dep.coffre.ecrire('g2/d2/d2.md', fiche('', 'entite'));
		await dep.coffre.ecrire('g2/d2/e1/e1.md', fiche());
		expect(await positionDuProjet(dep, 'h1/d1')).toEqual(nonRattache('h1/d1'));
		expect(await positionDuProjet(dep, 'd2/e1')).toEqual(nonRattache('d2/e1'));
	});

	it('dossier_projet posé : la position suit, pour le dossier et ses sous-dossiers ; le parent reste non rattaché', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('g1/d1/d1.md', fiche('dossier_projet: h1/d1\n'));
		expect(await positionDuProjet(dep, 'h1/d1')).toEqual(couvert('g1/d1', 'h1/d1'));
		expect(await positionDuProjet(dep, 'h1/d1/e1/i1')).toEqual(couvert('g1/d1', 'h1/d1/e1/i1'));
		expect(await positionDuProjet(dep, 'h1')).toEqual(nonRattache('h1'));
	});
});

describe('positionDuProjet : casse et égalités', () => {
	it('dossier_projet insensible à la casse', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('g1/d1/d1.md', fiche('dossier_projet: H1\n'));
		expect(await positionDuProjet(dep, 'h1/e1')).toEqual(couvert('g1/d1', 'h1/e1'));
	});

	it('égalité de déclarations : fiche au chemin le plus court, puis alphabétique', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('g1/z.md', fiche('dossier_projet: h1\n', 'entite'));
		await dep.coffre.ecrire('g1/b/b.md', fiche('dossier_projet: h1\n'));
		await dep.coffre.ecrire('g1/a.md', fiche('dossier_projet: h1\n', 'entite'));
		expect(await positionDuProjet(dep, 'h1')).toEqual(couvert('g1/a.md', 'h1'));
	});
});

describe('positionValide', () => {
	it('refuse l\'absolu et « .. », accepte la racine', () => {
		expect(positionValide('/etc')).toBeNull();
		expect(positionValide('../x')).toBeNull();
		expect(positionValide('')).toBe('');
		expect(positionValide('g1/d1')).toBe('g1/d1');
	});
});
