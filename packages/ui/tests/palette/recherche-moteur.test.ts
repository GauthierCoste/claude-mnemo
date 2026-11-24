// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FournisseurClient } from '../../src/client/contexte.tsx';
import { ATTENTE_COMPLETE_MS, ATTENTE_RAPIDE_MS, LIMITE_MOTEUR, useRechercheMoteur, type GenreMoteur } from '../../src/palette/useRechercheMoteur.ts';
import { creerFauxClient } from '../aides/faux-client.tsx';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

type Props = { q: string; dossier: string | null; genre: GenreMoteur | null; actif: boolean };

function monter(initial: Props, recherche: (p: Record<string, string>) => unknown = () => ({ trouves: [], avis: {} })) {
	const faux = creerFauxClient({ '/api/recherche': (p: Record<string, string> | undefined) => recherche(p ?? {}) });
	const wrapper = ({ children }: { children: ReactNode }) => createElement(FournisseurClient, { client: faux.client, children });
	const rendu = renderHook((o: Props) => useRechercheMoteur(o.q, o), { wrapper, initialProps: initial });
	const appels = () => faux.api.lire.mock.calls.filter(([chemin]) => chemin === '/api/recherche').map(([, params]) => params as Record<string, string>);
	const signaux = () => faux.api.lire.mock.calls.filter(([chemin]) => chemin === '/api/recherche').map(([, , o]) => (o as { signal: AbortSignal }).signal);
	const options = () => faux.api.lire.mock.calls.filter(([chemin]) => chemin === '/api/recherche').map(([, , o]) => o as { remplacement?: string });
	return { rendu, appels, signaux, options };
}

const base: Props = { q: 'stocks', dossier: null, genre: null, actif: true };

describe('useRechercheMoteur', () => {
	it(`mots seuls ${ATTENTE_RAPIDE_MS} ms après la frappe, complet après ${ATTENTE_COMPLETE_MS} ms sans frappe ; dossier, genre et limite transmis`, async () => {
		const { rendu, appels } = monter({ ...base, dossier: 'projets/erp', genre: 'fiche' });
		expect([ATTENTE_RAPIDE_MS, ATTENTE_COMPLETE_MS]).toEqual([120, 350]);
		await act(async () => vi.advanceTimersByTime(ATTENTE_RAPIDE_MS - 1));
		expect(appels()).toEqual([]);
		await act(async () => vi.advanceTimersByTime(1));
		const attendu = { q: 'stocks', limite: String(LIMITE_MOTEUR), dossier: 'projets/erp', genre: 'fiche' };
		expect(appels()).toEqual([{ ...attendu, rapide: '1' }]);
		expect(rendu.result.current).toMatchObject({ trouves: [], complet: false, enCours: true });
		await act(async () => vi.advanceTimersByTime(ATTENTE_COMPLETE_MS - ATTENTE_RAPIDE_MS - 1));
		expect(appels()).toHaveLength(1);
		await act(async () => vi.advanceTimersByTime(1));
		expect(appels()).toEqual([{ ...attendu, rapide: '1' }, attendu]);
		expect(rendu.result.current).toMatchObject({ trouves: [], complet: true, enCours: false, erreur: null });
	});

	it('frappe rapide : un appel « mots seuls » par pause courte, un seul appel complet (le dernier texte) ; les précédents abandonnés', async () => {
		const { rendu, appels, signaux } = monter({ ...base, q: 'st' });
		for (const q of ['sto', 'stoc', 'stock', 'stocks']) {
			await act(async () => vi.advanceTimersByTime(200));
			rendu.rerender({ ...base, q });
		}
		await act(async () => vi.advanceTimersByTime(1000));
		const complets = appels().filter((p) => p['rapide'] === undefined);
		expect(complets).toEqual([expect.objectContaining({ q: 'stocks' })]);
		expect(appels().filter((p) => p['rapide'] === '1').map((p) => p['q'])).toEqual(['st', 'sto', 'stoc', 'stock', 'stocks']);
		expect(signaux().slice(0, -2).every((s) => s.aborted)).toBe(true);
		expect(signaux().slice(-2).some((s) => s.aborted)).toBe(false);
	});

	it('seul l’appel complet porte la clé de remplacement « palette » (les mots seuls, courts, ne sont jamais remplacés)', async () => {
		const { options } = monter(base);
		await act(async () => vi.advanceTimersByTime(ATTENTE_COMPLETE_MS));
		expect(options().map((o) => o.remplacement)).toEqual([undefined, 'palette']);
	});

	it('appel complet remplacé (abandon) : rien affiché comme erreur, la réponse des mots seuls reste', async () => {
		const trouve = { id: 'a.md', chemin: 'a.md' };
		const { rendu } = monter(base, (p) => (p['rapide'] === '1' ? { trouves: [trouve], avis: {} } : Promise.reject(new DOMException('Requête remplacée par une plus récente.', 'AbortError'))));
		await act(async () => vi.advanceTimersByTime(ATTENTE_COMPLETE_MS));
		expect(rendu.result.current.erreur).toBeNull();
		expect(rendu.result.current.trouves).toEqual([trouve]);
	});

	it('échec des mots seuls arrivé après la réponse complète : ignoré (la réponse complète reste, sans erreur)', async () => {
		let echouer: (e: Error) => void = () => {};
		const complet = { id: 'b.md', chemin: 'b.md', note: 0.8 };
		const { rendu } = monter(base, (p) => (p['rapide'] === '1' ? new Promise((_r, rejeter) => (echouer = rejeter)) : { trouves: [complet], avis: {} }));
		await act(async () => vi.advanceTimersByTime(ATTENTE_COMPLETE_MS));
		expect(rendu.result.current).toMatchObject({ trouves: [complet], complet: true, erreur: null });
		await act(async () => echouer(new Error('Service injoignable.')));
		expect(rendu.result.current).toMatchObject({ trouves: [complet], complet: true, erreur: null });
	});

	it('rien sous deux caractères, ni inactive (filtre Sessions)', async () => {
		const { rendu, appels } = monter({ ...base, q: ' s ' });
		await act(async () => vi.advanceTimersByTime(1000));
		expect(appels()).toEqual([]);
		expect(rendu.result.current).toMatchObject({ trouves: null, enCours: false });
		rendu.rerender({ ...base, actif: false });
		await act(async () => vi.advanceTimersByTime(1000));
		expect(appels()).toEqual([]);
	});
});
