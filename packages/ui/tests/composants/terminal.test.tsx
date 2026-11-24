// @vitest-environment happy-dom
import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { plateformeMac } from '../../src/raccourcis.ts';
import { Terminal } from '../../src/terminal/Terminal.tsx';
import { creerFauxClient, rendreAvecClient } from '../aides/faux-client.tsx';

type Options = {
	fontSize?: number;
	fontFamily?: string;
	scrollback?: number;
	theme?: Record<string, string>;
	linkHandler?: { activate(e: MouseEvent, uri: string): void; allowNonHttpProtocols?: boolean };
};

// xterm simulé : le test garde la main sur le gestionnaire de touches et sur la saisie.
const xterm = vi.hoisted(() => ({
	instances: [] as {
		options: Options;
		gestionnaire: ((e: KeyboardEvent) => boolean) | null;
		ecrit: string[];
		resets: number;
		disposes: number;
		saisie: ((d: string) => void) | null;
		binaire: ((d: string) => void) | null;
	}[],
}));

vi.mock('@xterm/xterm', () => ({
	Terminal: class {
		options: Options;
		cols = 80;
		rows = 24;
		gestionnaire: ((e: KeyboardEvent) => boolean) | null = null;
		ecrit: string[] = [];
		resets = 0;
		disposes = 0;
		saisie: ((d: string) => void) | null = null;
		binaire: ((d: string) => void) | null = null;
		constructor(options: Options) {
			this.options = { ...options };
			xterm.instances.push(this);
		}
		loadAddon() {}
		open() {}
		attachCustomKeyEventHandler(f: (e: KeyboardEvent) => boolean) {
			this.gestionnaire = f;
		}
		onData(f: (d: string) => void) {
			this.saisie = f;
			return { dispose: () => (this.saisie = null) };
		}
		onBinary(f: (d: string) => void) {
			this.binaire = f;
			return { dispose: () => (this.binaire = null) };
		}
		// position de défilement gardée quand le terminal est caché (Terminal.tsx, garderLeDefilement)
		buffer = { active: { viewportY: 0, baseY: 0 } };
		onScroll() {
			return { dispose() {} };
		}
		onWriteParsed() {
			return { dispose() {} };
		}
		scrollToBottom() {}
		scrollToLine() {}
		write(d: string, fini?: () => void) {
			this.ecrit.push(d);
			fini?.();
		}
		reset() {
			this.resets++;
		}
		resize(c: number, l: number) {
			this.cols = c;
			this.rows = l;
		}
		focus() {}
		dispose() {
			this.disposes++;
		}
	},
}));

vi.mock('@xterm/addon-fit', () => ({
	FitAddon: class {
		proposeDimensions() {
			return { cols: 100, rows: 30 };
		}
	},
}));

const touche = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);
const dernier = () => xterm.instances.at(-1)!;

beforeEach(() => {
	xterm.instances.length = 0;
});
afterEach(cleanup);

describe('Terminal', () => {
	it('Échap, les touches ordinaires et toutes les touches ⌥ vont à claude (AZERTY : ⌥( → {) ; seuls ⌘K (et Ctrl+K hors macOS) sont gardés par l’interface', () => {
		const { client } = creerFauxClient();
		rendreAvecClient(<Terminal session="s-1" actif compact={false} surFocus={() => {}} />, client);
		const g = dernier().gestionnaire!;
		expect(g(touche({ code: 'Escape', key: 'Escape' }))).toBe(true);
		expect(g(touche({ code: 'KeyA', key: 'a' }))).toBe(true);
		expect(g(touche({ code: 'Enter', key: 'Enter' }))).toBe(true);
		expect(g(touche({ code: 'Digit5', key: '{', altKey: true }))).toBe(true);
		expect(g(touche({ code: 'Digit2', key: '™', altKey: true }))).toBe(true);
		expect(g(touche({ code: 'Digit0', key: 'º', altKey: true }))).toBe(true);
		expect(g(touche({ code: 'KeyA', key: 'å', altKey: true }))).toBe(true);
		expect(g(touche({ code: 'KeyA', key: 'Å', altKey: true, shiftKey: true }))).toBe(true);
		expect(g(touche({ code: 'KeyM', key: 'µ', altKey: true }))).toBe(true);
		expect(g(touche({ code: 'Comma', key: '…', altKey: true }))).toBe(true);
		expect(g(touche({ code: 'KeyK', key: 'k', metaKey: true }))).toBe(false);
		expect(g(touche({ code: 'KeyK', key: 'k', ctrlKey: true }))).toBe(plateformeMac());
	});

	it('xterm : police mono résolue, 12,5 px (11,5 px en carte compacte), défilement 5 000 lignes, thème des jetons', () => {
		document.documentElement.style.setProperty('--mono', "'Geist Mono', monospace");
		document.documentElement.style.setProperty('--terminal-fond', 'noir-de-test');
		const { client } = creerFauxClient();
		rendreAvecClient(<Terminal session="s-1" actif={false} compact={false} surFocus={() => {}} />, client);
		expect(dernier().options).toMatchObject({ fontSize: 12.5, scrollback: 5000, fontFamily: "'Geist Mono', monospace" });
		expect(dernier().options.theme?.['background']).toBe('noir-de-test');
		cleanup();
		rendreAvecClient(<Terminal session="s-1" actif={false} compact surFocus={() => {}} />, client);
		expect(dernier().options.fontSize).toBe(11.5);
	});

	it('branché à la connexion : relecture → reset puis écriture ; saisie et binaire → entree', () => {
		const { client, connexion } = creerFauxClient();
		rendreAvecClient(<Terminal session="s-1" actif={false} compact={false} surFocus={() => {}} />, client);
		act(() => connexion.emettre({ type: 'relecture', session: 's-1', donnees: 'écran' }));
		// Une remise à zéro à l’abonnement, une avant la relecture.
		expect(dernier().resets).toBe(2);
		expect(dernier().ecrit).toEqual(['écran']);
		dernier().saisie!('a');
		dernier().binaire!('\x80');
		expect(connexion.envoyes).toEqual([
			{ type: 'entree', session: 's-1', donnees: 'a' },
			{ type: 'entree', session: 's-1', donnees: '\x80' },
		]);
	});

	it('liens OSC 8 : seulement http(s), avec ⌘ ou Ctrl ; javascript: et file: ignorés', () => {
		const ouvrir = vi.spyOn(window, 'open').mockImplementation(() => null);
		const { client } = creerFauxClient();
		rendreAvecClient(<Terminal session="s-1" actif={false} compact={false} surFocus={() => {}} />, client);
		const liens = dernier().options.linkHandler!;
		expect(liens.allowNonHttpProtocols).toBe(false);
		const clic = (o: MouseEventInit = {}) => new MouseEvent('click', o);
		liens.activate(clic({ metaKey: true }), 'javascript:alert(1)');
		liens.activate(clic({ ctrlKey: true }), 'file:///etc/passwd');
		liens.activate(clic(), 'https://exemple.org');
		expect(ouvrir).not.toHaveBeenCalled();
		liens.activate(clic({ metaKey: true }), 'https://exemple.org');
		expect(ouvrir).toHaveBeenCalledWith('https://exemple.org', '_blank', 'noopener,noreferrer');
		ouvrir.mockRestore();
	});

	it('première connexion en cours → pas de « Hors ligne »', () => {
		const { client } = creerFauxClient({}, 'connexion');
		rendreAvecClient(<Terminal session="s-1" actif compact={false} surFocus={() => {}} />, client);
		expect(screen.queryByText('Hors ligne')).toBeNull();
	});

	it('connexion fermée → « Hors ligne »', () => {
		const { client, connexion } = creerFauxClient({}, 'reconnexion');
		rendreAvecClient(<Terminal session="s-1" actif compact={false} surFocus={() => {}} />, client);
		expect(screen.getByText('Hors ligne')).toBeTruthy();
		act(() => connexion.passerA('ouverte'));
		expect(screen.queryByText('Hors ligne')).toBeNull();
	});

	it('focus dans le terminal → surFocus ; démontage → xterm détruit une seule fois', () => {
		const { client } = creerFauxClient();
		const surFocus = vi.fn();
		const { container, unmount } = rendreAvecClient(<Terminal session="s-1" actif={false} compact={false} surFocus={surFocus} />, client);
		const champ = document.createElement('textarea');
		container.querySelector('[data-ecran]')!.append(champ);
		act(() => champ.focus());
		expect(surFocus).toHaveBeenCalledTimes(1);
		const t = dernier();
		unmount();
		expect(t.disposes).toBe(1);
	});
});
