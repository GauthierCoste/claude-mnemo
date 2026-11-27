// @vitest-environment happy-dom
import { estCouleurHex } from '@mnemo/commun';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACCENT_PAR_DEFAUT, appliquerAccent, contraste, luminance, normaliserHex, surChangementAccent, texteSurAccent } from '../../src/reglages/accent.ts';
import { COUCHES } from '../../src/reglages/logo.ts';

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

describe('saisie libre d’un code hexadécimal', () => {
	it('normalisée en #rrggbb minuscule : # facultatif, forme courte dépliée, espaces ignorés', () => {
		expect(normaliserHex('#3A7BD5')).toBe('#3a7bd5');
		expect(normaliserHex('3a7bd5')).toBe('#3a7bd5');
		expect(normaliserHex(' #1d3 ')).toBe('#11dd33');
		expect(normaliserHex('abc')).toBe('#aabbcc');
	});

	it('refusée si ce n’est pas une couleur hexadécimale', () => {
		for (const v of ['', '#', '#12', '#12345', '#1234567', '#ggg', 'vert', '##abc']) expect(normaliserHex(v), v).toBeNull();
	});
});

describe('logo à la couleur principale : icône de la page', () => {
	/** Faux canevas 2D : retient les couleurs de trait et de fond, et rend un PNG `data:` qui les nomme. */
	function fauxCanevas() {
		const traces: { trait: string[]; fond: string[] } = { trait: [], fond: [] };
		const ctx = {
			scale() {},
			translate() {},
			beginPath() {},
			roundRect() {},
			save() {},
			restore() {},
			set fillStyle(v: string) {
				traces.fond.push(v);
			},
			set strokeStyle(v: string) {
				traces.trait.push(v);
			},
			fill() {},
			stroke() {},
			lineWidth: 0,
			lineCap: '',
			lineJoin: '',
			globalAlpha: 1,
		};
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as RenderingContext);
		vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => `data:image/png;base64,${btoa(`${traces.fond.at(-1)} ${traces.trait.at(-1)}`)}`);
		vi.stubGlobal('Path2D', class {});
		return traces;
	}

	it('appliquerAccent redessine l’icône de la page en PNG au trait de la couleur choisie, sur le fond --s1', () => {
		const traces = fauxCanevas();
		const lien = document.createElement('link');
		lien.rel = 'icon';
		lien.href = '/icone.svg';
		lien.type = 'image/svg+xml';
		document.head.append(lien);
		const racine = document.documentElement;
		racine.style.setProperty('--s1', '#0f1013');
		try {
			appliquerAccent(racine, '#3A7BD5');
			expect(lien.type).toBe('image/png');
			expect(lien.href).toBe(`data:image/png;base64,${btoa('#0f1013 #3a7bd5')}`);
			expect(traces.trait).toEqual(['#3a7bd5']);
			// les trois couches du dessin, de la plus pâle à l'opaque
			expect(COUCHES.map((k) => k.opacite)).toEqual([0.18, 0.4, 1]);
			// même couleur : rien n'est redessiné
			appliquerAccent(racine, '#3a7bd5');
			expect(traces.trait).toHaveLength(1);
			appliquerAccent(racine, '#ffd23f');
			expect(lien.href).toBe(`data:image/png;base64,${btoa('#0f1013 #ffd23f')}`);
		} finally {
			lien.remove();
			racine.style.removeProperty('--s1');
			racine.style.removeProperty('--ac');
			racine.style.removeProperty('--sur-accent');
			vi.restoreAllMocks();
			vi.unstubAllGlobals();
		}
	});
});
