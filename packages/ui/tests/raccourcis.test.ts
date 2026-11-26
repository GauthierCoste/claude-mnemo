// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { actionDuRaccourci, origineDeLaTouche, pliageArbre, plateformeMac, raccourciAlt, toucheCommande } from '../src/raccourcis.ts';

const touche = (code: string, o: Partial<{ key: string; altKey: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {}) => ({
	code,
	key: o.key ?? code,
	altKey: o.altKey ?? false,
	metaKey: o.metaKey ?? false,
	ctrlKey: o.ctrlKey ?? false,
	shiftKey: o.shiftKey ?? false,
});
const hors = { origine: 'page', mac: false } as const;
const dans = { origine: 'terminal', mac: false } as const;
const champ = { origine: 'champ', mac: false } as const;

describe('actionDuRaccourci', () => {
	it('⌥3 → session 3 (par le code, même si ⌥ change la lettre)', () => {
		expect(actionDuRaccourci(touche('Digit3', { altKey: true, key: '“' }), hors)).toEqual({ genre: 'session', rang: 3 });
		expect(actionDuRaccourci(touche('Digit9', { altKey: true }), hors)).toEqual({ genre: 'session', rang: 9 });
	});

	it('⌥, → réglages (comme ⌥A, ⌥L), sur toute plateforme ; ⌘, et Ctrl+, restent au navigateur et au terminal', () => {
		expect(actionDuRaccourci(touche('Comma', { altKey: true, key: '≤' }), { origine: 'page', mac: true })).toEqual({ genre: 'reglages' });
		expect(actionDuRaccourci(touche('Comma', { altKey: true, key: ',' }), hors)).toEqual({ genre: 'reglages' });
		expect(actionDuRaccourci(touche('Comma', { metaKey: true, key: ',' }), { origine: 'page', mac: true })).toBeNull();
		expect(actionDuRaccourci(touche('Comma', { ctrlKey: true, key: ',' }), hors)).toBeNull();
		expect(actionDuRaccourci(touche('Comma', { key: ',' }), hors)).toBeNull();
	});

	it('⌥0 → grille', () => {
		expect(actionDuRaccourci(touche('Digit0', { altKey: true }), hors)).toEqual({ genre: 'grille' });
	});

	it('⌥A → archiviste, ⌥M → première fiche servie', () => {
		expect(actionDuRaccourci(touche('KeyA', { altKey: true, key: 'æ' }), hors)).toEqual({ genre: 'archiviste' });
		expect(actionDuRaccourci(touche('KeyM', { altKey: true }), hors)).toEqual({ genre: 'fiche_servie' });
	});

	it('⌥⇧A → archiviste en grand (ou réduit)', () => {
		expect(actionDuRaccourci(touche('KeyA', { altKey: true, shiftKey: true, key: 'Æ' }), hors)).toEqual({ genre: 'archiviste_grand' });
		expect(actionDuRaccourci(touche('KeyA', { shiftKey: true, key: 'A' }), hors)).toBeNull();
	});

	it('⌥L → localiser', () => {
		expect(actionDuRaccourci(touche('KeyL', { altKey: true, key: '¬' }), hors)).toEqual({ genre: 'localiser' });
	});

	it('dans un champ ou un terminal, aucun raccourci ⌥ : la touche produit son caractère (AZERTY : ⌥( → {, ⌥7 → «, ⌥, → …)', () => {
		const touchesAlt = [
			touche('Digit5', { altKey: true, key: '{' }),
			touche('Digit7', { altKey: true, key: '«' }),
			touche('Digit0', { altKey: true, key: 'ø' }),
			touche('KeyA', { altKey: true, key: 'æ' }),
			touche('KeyA', { altKey: true, shiftKey: true, key: 'Æ' }),
			touche('KeyM', { altKey: true, key: 'µ' }),
			touche('KeyL', { altKey: true, key: '¬' }),
			touche('Comma', { altKey: true, key: '…' }),
		];
		for (const t of touchesAlt) {
			expect(actionDuRaccourci(t, champ)).toBeNull();
			expect(actionDuRaccourci(t, dans)).toBeNull();
			expect(actionDuRaccourci(t, { origine: 'champ', mac: true })).toBeNull();
		}
	});

	it('⌘K (et Ctrl+K hors macOS) reste pris dans un champ et dans un terminal', () => {
		expect(actionDuRaccourci(touche('KeyK', { metaKey: true, key: 'k' }), champ)).toEqual({ genre: 'palette' });
		expect(actionDuRaccourci(touche('KeyK', { metaKey: true, key: 'k' }), dans)).toEqual({ genre: 'palette' });
		expect(actionDuRaccourci(touche('KeyK', { ctrlKey: true, key: 'k' }), champ)).toEqual({ genre: 'palette' });
	});

	it('Échap : sur la page et dans un champ → echap, dans un terminal → null', () => {
		expect(actionDuRaccourci(touche('Escape', { key: 'Escape' }), hors)).toEqual({ genre: 'echap' });
		expect(actionDuRaccourci(touche('Escape', { key: 'Escape' }), champ)).toEqual({ genre: 'echap' });
		expect(actionDuRaccourci(touche('Escape', { key: 'Escape' }), dans)).toBeNull();
	});

	it('⌘K et Ctrl+K → palette', () => {
		expect(actionDuRaccourci(touche('KeyK', { metaKey: true, key: 'k' }), hors)).toEqual({ genre: 'palette' });
		expect(actionDuRaccourci(touche('KeyK', { ctrlKey: true, key: 'k' }), dans)).toEqual({ genre: 'palette' });
	});

	it('macOS : seul ⌘K ouvre la palette ; Ctrl+K va à claude (effacer jusqu’à la fin de la ligne)', () => {
		expect(actionDuRaccourci(touche('KeyK', { metaKey: true, key: 'k' }), { origine: 'terminal', mac: true })).toEqual({ genre: 'palette' });
		expect(actionDuRaccourci(touche('KeyK', { ctrlKey: true, key: 'k' }), { origine: 'terminal', mac: true })).toBeNull();
		expect(actionDuRaccourci(touche('KeyK', { ctrlKey: true, key: 'k' }), { origine: 'page', mac: true })).toBeNull();
	});

	it('toucheCommande : ⌘ (Meta) sous macOS, Ctrl+ (Control) ailleurs ; un seul libellé pour la palette et les arbres', () => {
		expect(toucheCommande(true)).toEqual({ libelle: '⌘', aria: 'Meta' });
		expect(toucheCommande(false)).toEqual({ libelle: 'Ctrl+', aria: 'Control' });
	});

	it('raccourciAlt : ⌥A, ⌥⇧A sous macOS ; Alt+A, Alt+Maj+A ailleurs', () => {
		expect(raccourciAlt('A', { mac: true })).toBe('⌥A');
		expect(raccourciAlt('A', { mac: true, maj: true })).toBe('⌥⇧A');
		expect(raccourciAlt('A', { mac: false })).toBe('Alt+A');
		expect(raccourciAlt('A', { mac: false, maj: true })).toBe('Alt+Maj+A');
		expect(raccourciAlt(',', { mac: false })).toBe('Alt+,');
	});

	it('plateformeMac : userAgentData d’abord, puis navigator.platform', () => {
		expect(plateformeMac({ platform: 'MacIntel', userAgentData: { platform: 'macOS' } })).toBe(true);
		expect(plateformeMac({ platform: '', userAgentData: { platform: 'macOS' } })).toBe(true);
		expect(plateformeMac({ platform: 'MacIntel' })).toBe(true);
		expect(plateformeMac({ platform: 'iPad' })).toBe(true);
		expect(plateformeMac({ platform: 'Win32' })).toBe(false);
		expect(plateformeMac({ platform: 'Linux x86_64', userAgentData: { platform: 'Linux' } })).toBe(false);
		expect(plateformeMac({})).toBe(false);
	});

	it('touche sans modificateur → null', () => {
		expect(actionDuRaccourci(touche('Digit3', { key: '3' }), hors)).toBeNull();
		expect(actionDuRaccourci(touche('KeyK', { key: 'k' }), hors)).toBeNull();
		expect(actionDuRaccourci(touche('KeyA', { key: 'a' }), hors)).toBeNull();
	});

	it('combinaisons étrangères → null', () => {
		expect(actionDuRaccourci(touche('Digit3', { altKey: true, metaKey: true }), hors)).toBeNull();
		expect(actionDuRaccourci(touche('KeyZ', { altKey: true }), hors)).toBeNull();
		expect(actionDuRaccourci(touche('Escape', { key: 'Escape', altKey: true }), hors)).toBeNull();
	});
});

describe('origineDeLaTouche', () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	const poser = (html: string): Element => {
		const hote = document.createElement('div');
		hote.innerHTML = html;
		document.body.append(hote);
		return hote.querySelector('[data-cible]')!;
	};

	it('input, textarea, select, [contenteditable] (et ce qu’il contient) → champ', () => {
		expect(origineDeLaTouche(poser('<input data-cible>'))).toBe('champ');
		expect(origineDeLaTouche(poser('<textarea data-cible></textarea>'))).toBe('champ');
		expect(origineDeLaTouche(poser('<select data-cible></select>'))).toBe('champ');
		expect(origineDeLaTouche(poser('<div contenteditable="true" data-cible></div>'))).toBe('champ');
		expect(origineDeLaTouche(poser('<div contenteditable=""><p><b data-cible>x</b></p></div>'))).toBe('champ');
		expect(origineDeLaTouche(poser('<div contenteditable="plaintext-only" data-cible></div>'))).toBe('champ');
		for (const type of ['text', 'search', 'email', 'url', 'tel', 'password', 'number']) expect(origineDeLaTouche(poser(`<input type="${type}" data-cible>`))).toBe('champ');
	});

	it('xterm (son champ caché compris) → terminal', () => {
		expect(origineDeLaTouche(poser('<div class="xterm"><textarea class="xterm-helper-textarea" data-cible></textarea></div>'))).toBe('terminal');
		expect(origineDeLaTouche(poser('<div class="xterm"><div data-cible></div></div>'))).toBe('terminal');
	});

	it('input qui n’écrit aucun texte (case à cocher, radio, curseur, bouton) → page', () => {
		expect(origineDeLaTouche(poser('<input type="checkbox" data-cible>'))).toBe('page');
		expect(origineDeLaTouche(poser('<input type="range" data-cible>'))).toBe('page');
		expect(origineDeLaTouche(poser('<input type="radio" data-cible>'))).toBe('page');
		expect(origineDeLaTouche(poser('<input type="button" data-cible>'))).toBe('page');
	});

	it('body, bouton, liste, [contenteditable="false"], cible absente → page', () => {
		expect(origineDeLaTouche(document.body)).toBe('page');
		expect(origineDeLaTouche(poser('<button data-cible>b</button>'))).toBe('page');
		expect(origineDeLaTouche(poser('<ul><li data-cible>x</li></ul>'))).toBe('page');
		expect(origineDeLaTouche(poser('<div contenteditable="false" data-cible></div>'))).toBe('page');
		expect(origineDeLaTouche(null)).toBe('page');
		expect(origineDeLaTouche(document)).toBe('page');
	});
});

describe('pliageArbre', () => {
	const mac = { mac: true };
	const autre = { mac: false };
	it('⌘- replie tout ; ⌘+ et ⌘= déplient tout (par le caractère, ou par la touche)', () => {
		expect(pliageArbre(touche('Minus', { key: '-', metaKey: true }), mac)).toBe('replier');
		expect(pliageArbre(touche('Digit6', { key: '-', metaKey: true }), mac)).toBe('replier');
		expect(pliageArbre(touche('NumpadSubtract', { key: '-', metaKey: true }), mac)).toBe('replier');
		expect(pliageArbre(touche('Equal', { key: '=', metaKey: true }), mac)).toBe('deplier');
		expect(pliageArbre(touche('Equal', { key: '+', metaKey: true }), mac)).toBe('deplier');
		expect(pliageArbre(touche('Slash', { key: '=', metaKey: true }), mac)).toBe('deplier');
		expect(pliageArbre(touche('NumpadAdd', { key: '+', metaKey: true }), mac)).toBe('deplier');
	});

	it('Ctrl hors macOS ; sans modificateur, avec ⌥, ou Ctrl sous macOS → null', () => {
		expect(pliageArbre(touche('Minus', { key: '-', ctrlKey: true }), autre)).toBe('replier');
		expect(pliageArbre(touche('Minus', { key: '-', ctrlKey: true }), mac)).toBeNull();
		expect(pliageArbre(touche('Minus', { key: '-' }), mac)).toBeNull();
		expect(pliageArbre(touche('Minus', { key: '–', metaKey: true, altKey: true }), mac)).toBeNull();
		expect(pliageArbre(touche('KeyK', { key: 'k', metaKey: true }), mac)).toBeNull();
	});
});
