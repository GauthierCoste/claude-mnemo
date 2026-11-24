// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FournisseurClient } from '../../src/client/contexte.tsx';
import { ATTENTE_RECHERCHE_MS, useRecherche } from '../../src/client/hooks.ts';
import { creerFauxClient } from '../aides/faux-client.tsx';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

function monter(attenteMs?: number) {
	// « stocks » ne répond jamais : sa requête est encore en cours à la frappe suivante.
	const faux = creerFauxClient({ '/api/recherche': (p?: Record<string, string>) => (p?.['q'] === 'stocks' ? new Promise(() => {}) : { trouves: [], avis: {} }) });
	const wrapper = ({ children }: { children: ReactNode }) => createElement(FournisseurClient, { client: faux.client, children });
	// Comme le graphe : la saisie part vide, puis l'on tape.
	const rendu = renderHook(({ q }) => (attenteMs === undefined ? useRecherche(q) : useRecherche(q, attenteMs)), { wrapper, initialProps: { q: '' } });
	rendu.rerender({ q: 'stocks' });
	const recherches = () => faux.api.lire.mock.calls.filter(([chemin]) => chemin === '/api/recherche').length;
	const options = () => faux.api.lire.mock.calls.filter(([chemin]) => chemin === '/api/recherche').map(([, , o]) => o as { remplacement?: string; signal?: AbortSignal } | undefined);
	return { recherches, options, rendu };
}

describe('useRecherche', () => {
	it('attend 200 ms après la dernière frappe', async () => {
		const { recherches } = monter();
		expect(ATTENTE_RECHERCHE_MS).toBe(200);
		await act(async () => vi.advanceTimersByTime(199));
		expect(recherches()).toBe(0);
		await act(async () => vi.advanceTimersByTime(1));
		expect(recherches()).toBe(1);
	});

	it('attente choisie par l’appelant (le graphe : 300 ms)', async () => {
		const { recherches } = monter(300);
		await act(async () => vi.advanceTimersByTime(299));
		expect(recherches()).toBe(0);
		await act(async () => vi.advanceTimersByTime(1));
		expect(recherches()).toBe(1);
	});

	it('recherche du graphe : clé de remplacement `graphe` (distincte de la palette), et une frappe suivante abandonne la requête précédente', async () => {
		const { options, rendu } = monter(300);
		await act(async () => vi.advanceTimersByTime(300));
		expect(options()).toHaveLength(1);
		expect(options()[0]?.remplacement).toBe('graphe');
		const premiere = options()[0]!.signal!;
		expect(premiere.aborted).toBe(false);
		rendu.rerender({ q: 'stocks bas' });
		await act(async () => vi.advanceTimersByTime(300));
		expect(options()).toHaveLength(2);
		expect(premiere.aborted).toBe(true);
		expect(options()[1]?.signal?.aborted).toBe(false);
	});
});
