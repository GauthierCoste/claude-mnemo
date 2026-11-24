// @vitest-environment happy-dom
import { estCouleurHex } from '@mnemo/commun';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACCENT_PAR_DEFAUT, appliquerAccent, contraste, luminance, surChangementAccent, texteSurAccent } from '../../src/reglages/accent.ts';

describe('couleur principale : choix du texte posé dessus', () => {
	it('luminance : noir 0, blanc 1', () => {
		expect(luminance('#000000')).toBe(0);
		expect(luminance('#ffffff')).toBeCloseTo(1, 5);
	});

	it('texte sombre sur un accent clair (le vert par défaut, un jaune), clair sur un accent foncé', () => {
		expect(texteSurAccent(ACCENT_PAR_DEFAUT)).toBe('sombre');
		expect(texteSurAccent('#ffd23f')).toBe('sombre');
		expect(texteSurAccent('#ffffff')).toBe('sombre');
		expect(texteSurAccent('#1d3557')).toBe('clair');
		expect(texteSurAccent('#6a1b9a')).toBe('clair');
		expect(texteSurAccent('#000000')).toBe('clair');
	});

	it('format : #rrggbb seulement', () => {
		expect(estCouleurHex('#7df0c6')).toBe(true);
		expect(estCouleurHex('#7DF0C6')).toBe(true);
		for (const v of ['#fff', '7df0c6', '#7df0c', 'vert', 12, null, undefined]) expect(estCouleurHex(v)).toBe(false);
	});
});

describe('appliquerAccent', () => {
	it('pose --ac et le texte lisible dessus sur la racine, en minuscules', () => {
		const racine = document.createElement('div');
		appliquerAccent(racine, '#1D3557');
		expect(racine.style.getPropertyValue('--ac')).toBe('#1d3557');
		expect(racine.style.getPropertyValue('--sur-accent')).toBe('var(--sur-accent-clair)');
		appliquerAccent(racine, '#ffd23f');
		expect(racine.style.getPropertyValue('--ac')).toBe('#ffd23f');
		expect(racine.style.getPropertyValue('--sur-accent')).toBe('var(--sur-accent-sombre)');
	});

	it('valeur invalide ou absente : le défaut', () => {
		const racine = document.createElement('div');
		appliquerAccent(racine, 'rouge');
		expect(racine.style.getPropertyValue('--ac')).toBe(ACCENT_PAR_DEFAUT);
		appliquerAccent(racine, undefined);
		expect(racine.style.getPropertyValue('--ac')).toBe(ACCENT_PAR_DEFAUT);
	});
});

describe('contraste avec le fond', () => {
	it('noir sur blanc 21, une couleur contre elle-même 1, symétrique', () => {
		expect(contraste('#000000', '#ffffff')).toBeCloseTo(21, 5);
		expect(contraste('#7df0c6', '#7df0c6')).toBeCloseTo(1, 5);
		expect(contraste('#09090b', '#7df0c6')).toBeCloseTo(contraste('#7df0c6', '#09090b'), 10);
	});

	it('le vert par défaut se lit sur le fond sombre, un bleu nuit non', () => {
		expect(contraste(ACCENT_PAR_DEFAUT, '#09090b')).toBeGreaterThan(3);
		expect(contraste('#1d3557', '#09090b')).toBeLessThan(3);
	});
});

describe('changement d’accent', () => {
	it('appliquerAccent prévient les abonnés ; se désabonner les arrête', () => {
		const racine = document.createElement('div');
		const f = vi.fn();
		const stop = surChangementAccent(racine, f);
		appliquerAccent(racine, '#ffd23f');
		expect(f).toHaveBeenCalledTimes(1);
		stop();
		appliquerAccent(racine, '#1d3557');
		expect(f).toHaveBeenCalledTimes(1);
	});
});

describe('défaut', () => {
	it('ACCENT_PAR_DEFAUT vaut --ac dans jetons.css', () => {
		const css = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'styles', 'jetons.css'), 'utf8');
		expect(/--ac:\s*(#[0-9a-f]{6})\s*;/i.exec(css)?.[1]?.toLowerCase()).toBe(ACCENT_PAR_DEFAUT);
	});
});
