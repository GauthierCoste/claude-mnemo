import { describe, expect, it } from 'vitest';
import { avecVersionPaquet, avecVersionReadme, estNiveau, problemeDesNotes, versionSuivante } from '../publier/version.ts';

describe('versionSuivante', () => {
	it('suit la convention Patch, Feature, Version', () => {
		expect(versionSuivante('1.11.7', 'patch')).toBe('1.11.8');
		expect(versionSuivante('1.11.7', 'feature')).toBe('1.12.0');
		expect(versionSuivante('1.11.7', 'version')).toBe('2.0.0');
	});
	it('refuse une version mal formée', () => {
		expect(() => versionSuivante('1.2', 'patch')).toThrow('x.y.z');
		expect(() => versionSuivante('v1.2.3', 'patch')).toThrow();
	});
});

it('estNiveau ne connaît que les trois niveaux', () => {
	expect(estNiveau('feature')).toBe(true);
	expect(estNiveau('minor')).toBe(false);
	expect(estNiveau(undefined)).toBe(false);
});

describe('avecVersionPaquet', () => {
	it('remplace la version seule, le reste intact', () => {
		const texte = '{\n  "name": "mnemo",\n  "version": "1.2.3",\n  "dependencies": { "x": "1.2.3" }\n}\n';
		expect(avecVersionPaquet(texte, '1.2.3', '1.3.0')).toBe('{\n  "name": "mnemo",\n  "version": "1.3.0",\n  "dependencies": { "x": "1.2.3" }\n}\n');
	});
	it("refuse un paquet qui n'est pas à l'ancienne version", () => {
		expect(() => avecVersionPaquet('{ "version": "1.0.0" }', '1.2.3', '1.3.0')).toThrow();
	});
});

describe('avecVersionReadme', () => {
	it('met à jour la ligne « Version », la suite de la ligne gardée', () => {
		const texte = '# Mnemo\n\nVersion 1.2.3. Mnemo runs on macOS.\n';
		expect(avecVersionReadme(texte, '1.2.3', '1.2.4')).toBe('# Mnemo\n\nVersion 1.2.4. Mnemo runs on macOS.\n');
	});
	it('refuse un README sans la ligne attendue', () => {
		expect(() => avecVersionReadme('Version 1.0.0.\n', '1.2.3', '1.2.4')).toThrow('README');
	});
});

describe('problemeDesNotes', () => {
	it('accepte des notes écrites', () => {
		expect(problemeDesNotes('**New in this version:**\n- something\n')).toBeNull();
	});
	it('refuse des notes vides ou réduites au gabarit', () => {
		expect(problemeDesNotes('  \n')).toMatch('vides');
		expect(problemeDesNotes('<!-- écrire ici -->\n')).toMatch('vides');
	});
	it("refuse une section d'installation, ajoutée par la CI", () => {
		expect(problemeDesNotes('- fix\n\n**Install on a Mac:** …')).toMatch('CI');
	});
});
