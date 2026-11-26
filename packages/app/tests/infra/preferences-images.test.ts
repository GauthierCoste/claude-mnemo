import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toutesLesImages } from '../../src/domaine/icone.ts';
import { PREFERENCES_DEFAUT } from '../../src/domaine/preferences.ts';
import { dossierImages, lireImagesBarre } from '../../src/infra/images-barre.ts';
import { cheminPreferences, ecrirePreferencesFichier, lirePreferencesFichier } from '../../src/infra/preferences-fichier.ts';

describe('fichier des préférences', () => {
	it('absent ou abîmé : valeurs par défaut ; écrit (0600) puis relu tel quel', () => {
		const dossier = join(mkdtempSync(join(tmpdir(), 'mnemo-app-prefs-')), 'Mnemo');
		const chemin = cheminPreferences(dossier);
		expect(lirePreferencesFichier(chemin)).toEqual(PREFERENCES_DEFAUT);
		const p = { ...PREFERENCES_DEFAUT, quitter: 'laisser' as const, fenetre: { x: 10, y: 30, largeur: 1000, hauteur: 700 }, verificationVersionsMs: 5 };
		ecrirePreferencesFichier(chemin, p);
		expect(lirePreferencesFichier(chemin)).toEqual(p);
		// droits POSIX : sous Windows, le mode ne dit rien des droits d'accès
		if (process.platform !== 'win32') expect(statSync(chemin).mode & 0o777).toBe(0o600);
		expect(readFileSync(chemin, 'utf8')).toMatch(/\n$/u);
		writeFileSync(chemin, '{ abîmé');
		expect(lirePreferencesFichier(chemin)).toEqual(PREFERENCES_DEFAUT);
	});
});

describe('images de la barre des menus', () => {
	it('lues à côté de main.js (ici, les sources de ressources/) ; une image absente est nommée', () => {
		const dossier = dossierImages(join(import.meta.dirname, '../../ressources'));
		const images = lireImagesBarre(dossier, toutesLesImages());
		expect([...images.keys()]).toEqual(toutesLesImages());
		for (const i of images.values()) expect(i.x2.length).toBeGreaterThan(0);
		expect(() => lireImagesBarre(dossier, ['etat-inconnuTemplate'])).toThrow(/etat-inconnuTemplate/u);
	});
});
