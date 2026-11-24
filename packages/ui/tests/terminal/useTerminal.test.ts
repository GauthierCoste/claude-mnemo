// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { createElement, StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../../src/client/api.ts';
import { creerConnexion, type Connexion } from '../../src/client/connexion.ts';
import { FournisseurClient, type Client } from '../../src/client/contexte.tsx';
import { ENTREE_MAX_OCTETS } from '@mnemo/contrat';
import { TAILLE_MAX_ENTREE } from '../../src/terminal/entree.ts';
import { ATTENTE_REDIMENSION_MS } from '../../src/terminal/taille.ts';
import { useTerminal, type Ecran } from '../../src/terminal/useTerminal.ts';
import { FauxWebSocket, FauxWebSocketType } from '../aides/faux-websocket.ts';

const SESSION = 's-1';

type FauxEcran = Ecran & {
	contenu: string;
	journal: string[];
	saisir(d: string): void;
	proposee: { colonnes: number; lignes: number } | null;
	/** Vrai : les rappels de fin d'écriture attendent `finirEcritures()` (xterm écrit de façon asynchrone). */
	differer: boolean;
	finirEcritures(): void;
};

function fauxEcran(): FauxEcran {
	let saisie: ((d: string) => void) | null = null;
	let taille = { colonnes: 80, lignes: 24 };
	const rappels: (() => void)[] = [];
	const e: FauxEcran = {
		differer: false,
		finirEcritures() {
			for (const f of rappels.splice(0)) f();
		},
		contenu: '',
		journal: [],
		proposee: { colonnes: 100, lignes: 30 },
		ecrire(d, fini) {
			e.journal.push(`ecrire:${d}`);
			e.contenu += d;
			if (fini) {
				if (e.differer) rappels.push(fini);
				else fini();
			}
		},
		reinitialiser() {
			e.journal.push('reinitialiser');
			e.contenu = '';
		},
		surSaisie(f) {
			saisie = f;
			return () => {
				saisie = null;
			};
		},
		dimensions: () => taille,
		ajuster: () => e.proposee,
		redimensionner(c, l) {
			e.journal.push(`redimensionner:${c}x${l}`);
			taille = { colonnes: c, lignes: l };
		},
		focus() {},
		detruire() {
			e.journal.push('detruire');
		},
		saisir(d) {
			saisie?.(d);
		},
	};
	return e;
}

class FauxResizeObserver {
	static instances: FauxResizeObserver[] = [];
	cibles: Element[] = [];
	private readonly rappel: ResizeObserverCallback;
	constructor(rappel: ResizeObserverCallback) {
		this.rappel = rappel;
		FauxResizeObserver.instances.push(this);
	}
	observe(el: Element): void {
		this.cibles.push(el);
	}
	unobserve(): void {}
	disconnect(): void {
		this.cibles = [];
	}
	static declencher(): void {
		for (const o of FauxResizeObserver.instances) if (o.cibles.length) o.rappel([], o as unknown as ResizeObserver);
	}
}

function preparer() {
	const connexion: Connexion = creerConnexion({ url: 'ws://127.0.0.1:4100/ws?jeton=x', WebSocket: FauxWebSocketType, verifierJeton: async () => true });
	const autreEcran = fauxEcran();
	const client: Client = { api: {} as Api, connexion, fictif: false, surJetonRefuse: () => () => {} };
	const conteneur = document.createElement('div');
	document.body.append(conteneur);
	const ecran = fauxEcran();
	const enveloppe = (strict: boolean) => (p: { children: ReactNode }) => {
		const contenu = createElement(FournisseurClient, { client, children: p.children });
		return strict ? createElement(StrictMode, null, contenu) : contenu;
	};
	return { connexion, conteneur, ecran, autreEcran, enveloppe };
}

const socket = () => FauxWebSocket.derniere();
const tailles = () => socket().envoyesDeType('taille');

beforeEach(() => {
	FauxWebSocket.reinitialiser();
	FauxResizeObserver.instances = [];
	vi.useFakeTimers();
	vi.stubGlobal('ResizeObserver', FauxResizeObserver);
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('useTerminal', () => {
	it('s’abonne à la session et dit si la connexion est ouverte', () => {
		const { ecran, conteneur, enveloppe } = preparer();
		const { result } = renderHook(() => useTerminal(SESSION, ecran, { actif: false, conteneur }), { wrapper: enveloppe(false) });
		expect(result.current.connecte).toBe(false);
		act(() => socket().ouvrir());
		expect(result.current.connecte).toBe(true);
		expect(socket().envoyesDeType('abonner')).toEqual([{ type: 'abonner', session: SESSION }]);
	});

	it('relecture après sortie → reinitialiser avant l’écriture, une seule copie à l’écran', () => {
		const { ecran, conteneur, enveloppe } = preparer();
		renderHook(() => useTerminal(SESSION, ecran, { actif: false, conteneur }), { wrapper: enveloppe(false) });
		act(() => socket().ouvrir());
		act(() => socket().recevoir({ type: 'sortie', session: SESSION, donnees: 'bonjour' }));
		act(() => socket().recevoir({ type: 'relecture', session: SESSION, donnees: 'bonjour' }));
		expect(ecran.journal).toEqual(['reinitialiser', 'ecrire:bonjour', 'reinitialiser', 'ecrire:bonjour']);
		expect(ecran.contenu).toBe('bonjour');
		act(() => socket().recevoir({ type: 'sortie', session: 'autre', donnees: 'x' }));
		expect(ecran.contenu).toBe('bonjour');
	});

	it('saisie → entree ; connexion fermée → refusée', () => {
		const { ecran, conteneur, enveloppe } = preparer();
		const { result } = renderHook(() => useTerminal(SESSION, ecran, { actif: true, conteneur }), { wrapper: enveloppe(false) });
		act(() => socket().ouvrir());
		ecran.saisir('ls\r');
		expect(socket().envoyesDeType('entree')).toEqual([{ type: 'entree', session: SESSION, donnees: 'ls\r' }]);
		act(() => socket().fermerDepuisServeur(1006));
		expect(result.current.connecte).toBe(false);
		expect(() => ecran.saisir('perdu')).not.toThrow();
		expect(socket().envoyesDeType('entree')).toHaveLength(1);
	});

	it('dix changements de taille en 300 ms → un seul `taille`, après le calme', () => {
		const { ecran, conteneur, enveloppe } = preparer();
		renderHook(() => useTerminal(SESSION, ecran, { actif: true, conteneur }), { wrapper: enveloppe(false) });
		act(() => socket().ouvrir());
		act(() => vi.advanceTimersByTime(500));
		socket().envoyes.length = 0;
		for (let i = 0; i < 10; i++) {
			ecran.proposee = { colonnes: 90 + i, lignes: 30 };
			act(() => FauxResizeObserver.declencher());
			act(() => vi.advanceTimersByTime(30));
		}
		expect(tailles()).toEqual([]);
		act(() => vi.advanceTimersByTime(ATTENTE_REDIMENSION_MS));
		expect(tailles()).toEqual([{ type: 'taille', session: SESSION, colonnes: 99, lignes: 30 }]);
		expect(ecran.dimensions()).toEqual({ colonnes: 99, lignes: 30 });
		act(() => FauxResizeObserver.declencher());
		act(() => vi.advanceTimersByTime(500));
		expect(tailles()).toHaveLength(1);
	});

	it('pendant que la grille porte la classe `drag`, on attend', () => {
		const { ecran, conteneur, enveloppe } = preparer();
		const grille = document.createElement('div');
		grille.className = 'drag';
		document.body.append(grille);
		grille.append(conteneur);
		renderHook(() => useTerminal(SESSION, ecran, { actif: true, conteneur }), { wrapper: enveloppe(false) });
		act(() => socket().ouvrir());
		act(() => FauxResizeObserver.declencher());
		act(() => vi.advanceTimersByTime(1000));
		expect(tailles()).toEqual([]);
		grille.classList.remove('drag');
		act(() => vi.advanceTimersByTime(ATTENTE_REDIMENSION_MS));
		expect(tailles()).toHaveLength(1);
	});

	it('terminal non actif → aucun `taille` (xterm redimensionné quand même), puis actif → un', () => {
		const { ecran, conteneur, enveloppe } = preparer();
		const { rerender } = renderHook((p: { actif: boolean }) => useTerminal(SESSION, ecran, { actif: p.actif, conteneur }), {
			wrapper: enveloppe(false),
			initialProps: { actif: false },
		});
		act(() => socket().ouvrir());
		act(() => FauxResizeObserver.declencher());
		act(() => vi.advanceTimersByTime(500));
		expect(tailles()).toEqual([]);
		expect(ecran.journal).toContain('redimensionner:100x30');
		rerender({ actif: true });
		act(() => vi.advanceTimersByTime(500));
		expect(tailles()).toEqual([{ type: 'taille', session: SESSION, colonnes: 100, lignes: 30 }]);
		// Il la renvoie quand il redevient actif (une autre carte a pu imposer la sienne entre-temps).
		rerender({ actif: false });
		rerender({ actif: true });
		act(() => vi.advanceTimersByTime(500));
		expect(tailles()).toHaveLength(2);
	});

	it('cellule cachée (`ajuster()` null) → rien', () => {
		const { ecran, conteneur, enveloppe } = preparer();
		ecran.proposee = null;
		renderHook(() => useTerminal(SESSION, ecran, { actif: true, conteneur }), { wrapper: enveloppe(false) });
		act(() => socket().ouvrir());
		act(() => FauxResizeObserver.declencher());
		act(() => vi.advanceTimersByTime(500));
		expect(tailles()).toEqual([]);
		expect(ecran.journal.filter((j) => j.startsWith('redimensionner'))).toEqual([]);
	});

	it('montage double (StrictMode) puis démontage → un seul `desabonner` au démontage, abonnements équilibrés', () => {
		const { ecran, conteneur, enveloppe } = preparer();
		const { unmount } = renderHook(() => useTerminal(SESSION, ecran, { actif: false, conteneur }), { wrapper: enveloppe(true) });
		act(() => socket().ouvrir());
		expect(socket().envoyesDeType('abonner')).toHaveLength(1);
		socket().envoyes.length = 0;
		unmount();
		expect(socket().envoyes).toEqual([{ type: 'desabonner', session: SESSION }]);
		ecran.saisir('x');
		expect(socket().envoyesDeType('entree')).toEqual([]);
	});

	it('reconnexion → nouvelle relecture, écran remis à zéro', () => {
		const { ecran, conteneur, enveloppe } = preparer();
		renderHook(() => useTerminal(SESSION, ecran, { actif: false, conteneur }), { wrapper: enveloppe(false) });
		act(() => socket().ouvrir());
		act(() => socket().recevoir({ type: 'relecture', session: SESSION, donnees: 'avant ' }));
		act(() => socket().recevoir({ type: 'sortie', session: SESSION, donnees: 'coupé' }));
		act(() => socket().fermerDepuisServeur(1006));
		act(() => vi.advanceTimersByTime(600));
		act(() => socket().ouvrir());
		expect(socket().envoyesDeType('abonner')).toEqual([{ type: 'abonner', session: SESSION }]);
		act(() => socket().recevoir({ type: 'relecture', session: SESSION, donnees: 'avant coupé, après' }));
		expect(ecran.contenu).toBe('avant coupé, après');
		expect(ecran.journal.filter((j) => j === 'reinitialiser')).toHaveLength(3);
	});
	it('cellule repliée : 2×1 (plancher de FitAddon) puis 15×3 → ni redimensionnement local ni envoi', () => {
		const { ecran, conteneur, enveloppe } = preparer();
		renderHook(() => useTerminal(SESSION, ecran, { actif: true, conteneur }), { wrapper: enveloppe(false) });
		act(() => socket().ouvrir());
		for (const proposee of [{ colonnes: 2, lignes: 1 }, { colonnes: 15, lignes: 3 }]) {
			ecran.proposee = proposee;
			act(() => FauxResizeObserver.declencher());
			act(() => vi.advanceTimersByTime(500));
		}
		expect(tailles()).toEqual([]);
		expect(ecran.journal.filter((j) => j.startsWith('redimensionner'))).toEqual([]);
		expect(ecran.dimensions()).toEqual({ colonnes: 80, lignes: 24 });
	});

	it('deux vues sur une session : la seconde redemande la relecture, les deux écrans sont complets, sans doublon', () => {
		const { ecran, autreEcran, conteneur, enveloppe } = preparer();
		renderHook(() => useTerminal(SESSION, ecran, { actif: false, conteneur }), { wrapper: enveloppe(false) });
		act(() => socket().ouvrir());
		act(() => socket().recevoir({ type: 'relecture', session: SESSION, donnees: 'un ' }));
		act(() => socket().recevoir({ type: 'sortie', session: SESSION, donnees: 'deux ' }));
		socket().envoyes.length = 0;
		renderHook(() => useTerminal(SESSION, autreEcran, { actif: false, conteneur }), { wrapper: enveloppe(false) });
		expect(socket().envoyes).toEqual([
			{ type: 'desabonner', session: SESSION },
			{ type: 'abonner', session: SESSION },
		]);
		act(() => socket().recevoir({ type: 'relecture', session: SESSION, donnees: 'un deux ' }));
		act(() => socket().recevoir({ type: 'sortie', session: SESSION, donnees: 'trois' }));
		expect(ecran.contenu).toBe('un deux trois');
		expect(autreEcran.contenu).toBe('un deux trois');
	});

	it('changement de session : ancien écran effacé, saisie vers la nouvelle session', () => {
		const { ecran, conteneur, enveloppe } = preparer();
		const { rerender } = renderHook((p: { session: string }) => useTerminal(p.session, ecran, { actif: false, conteneur }), {
			wrapper: enveloppe(false),
			initialProps: { session: SESSION },
		});
		act(() => socket().ouvrir());
		act(() => socket().recevoir({ type: 'relecture', session: SESSION, donnees: 'ancienne' }));
		socket().envoyes.length = 0;
		rerender({ session: 's-2' });
		expect(ecran.contenu).toBe('');
		expect(socket().envoyes).toEqual([
			{ type: 'desabonner', session: SESSION },
			{ type: 'abonner', session: 's-2' },
		]);
		act(() => socket().recevoir({ type: 'sortie', session: SESSION, donnees: 'perdue' }));
		expect(ecran.contenu).toBe('');
		ecran.saisir('x');
		expect(socket().envoyesDeType('entree')).toEqual([{ type: 'entree', session: 's-2', donnees: 'x' }]);
	});

	it('pendant l’écriture d’une relecture, les réponses d’xterm aux requêtes rejouées ne sont pas renvoyées', () => {
		const { ecran, conteneur, enveloppe } = preparer();
		renderHook(() => useTerminal(SESSION, ecran, { actif: false, conteneur }), { wrapper: enveloppe(false) });
		act(() => socket().ouvrir());
		ecran.differer = true;
		act(() => socket().recevoir({ type: 'relecture', session: SESSION, donnees: '\x1b[c' }));
		ecran.saisir('\x1b[?1;2c');
		expect(socket().envoyesDeType('entree')).toEqual([]);
		ecran.finirEcritures();
		ecran.saisir('a');
		expect(socket().envoyesDeType('entree')).toEqual([{ type: 'entree', session: SESSION, donnees: 'a' }]);
	});

	it('trame de saisie : la constante du contrat, celle que le service accepte', () => {
		expect(TAILLE_MAX_ENTREE).toBe(ENTREE_MAX_OCTETS);
	});

	it('collage : découpé en trames de TAILLE_MAX_ENTREE octets au plus, dans l’ordre', () => {
		const { ecran, conteneur, enveloppe } = preparer();
		renderHook(() => useTerminal(SESSION, ecran, { actif: false, conteneur }), { wrapper: enveloppe(false) });
		act(() => socket().ouvrir());
		const texte = 'a'.repeat(TAILLE_MAX_ENTREE * 2 + 10) + 'é'.repeat(40_000) + '😀'.repeat(20_000);
		ecran.saisir(texte);
		const trames = (socket().envoyesDeType('entree') as { donnees: string }[]).map((m) => m.donnees);
		expect(trames.join('')).toBe(texte);
		expect(trames.length).toBeGreaterThan(3);
		for (const t of trames) {
			expect(new TextEncoder().encode(t).length).toBeLessThanOrEqual(TAILLE_MAX_ENTREE);
			expect(t.isWellFormed()).toBe(true);
		}
	});

	it('envoi refusé en plein collage → arrêt, « hors ligne »', () => {
		const { ecran, conteneur, enveloppe } = preparer();
		const { result } = renderHook(() => useTerminal(SESSION, ecran, { actif: false, conteneur }), { wrapper: enveloppe(false) });
		act(() => socket().ouvrir());
		expect(result.current.horsLigne).toBe(false);
		const s = socket();
		const envoyer = s.send.bind(s);
		let n = 0;
		s.send = (d: string) => {
			if (++n > 1) throw new Error('coupée');
			envoyer(d);
		};
		act(() => ecran.saisir('b'.repeat(TAILLE_MAX_ENTREE * 3)));
		expect(s.envoyesDeType('entree')).toHaveLength(1);
		expect(result.current.horsLigne).toBe(true);
	});

	it('« hors ligne » : pas pendant la première connexion, oui en reconnexion', () => {
		const { ecran, conteneur, enveloppe } = preparer();
		const { result } = renderHook(() => useTerminal(SESSION, ecran, { actif: false, conteneur }), { wrapper: enveloppe(false) });
		expect(result.current).toEqual({ connecte: false, horsLigne: false });
		act(() => socket().ouvrir());
		act(() => socket().fermerDepuisServeur(1006));
		expect(result.current).toEqual({ connecte: false, horsLigne: true });
	});
});

