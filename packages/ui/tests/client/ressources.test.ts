// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ErreurApi } from '../../src/client/api.ts';
import { FournisseurClient, useCacheRessources } from '../../src/client/contexte.tsx';
import { etatPartage, publierRessource, useRessource } from '../../src/client/ressources.ts';
import { creerFauxClient } from '../aides/faux-client.tsx';

afterEach(cleanup);

function differe<T>() {
	let resoudre!: (v: T) => void;
	const promesse = new Promise<T>((r) => (resoudre = r));
	return { promesse, resoudre };
}

function monter(memoire: boolean, cle: string | null = 'graphe') {
	const faux = creerFauxClient();
	const attentes: { resoudre(v: string): void }[] = [];
	const charger = () => {
		const d = differe<string>();
		attentes.push(d);
		return d.promesse;
	};
	const wrapper = ({ children }: { children: ReactNode }) => createElement(FournisseurClient, { client: faux.client, children });
	const rendu = renderHook(({ c }) => useRessource(c, charger, { memoire }), { wrapper, initialProps: { c: cle } });
	return { faux, attentes, rendu };
}

describe('useRessource', () => {
	it('charge, puis se recharge au message memoire en gardant les anciennes données', async () => {
		const { faux, attentes, rendu } = monter(true);
		expect(rendu.result.current).toMatchObject({ donnees: undefined, chargement: true, erreur: null });
		await act(async () => attentes[0]!.resoudre('v1'));
		expect(rendu.result.current).toMatchObject({ donnees: 'v1', chargement: false });

		act(() => faux.connexion.emettre({ type: 'memoire', modifieeMs: 1 }));
		await waitFor(() => expect(attentes).toHaveLength(2));
		expect(rendu.result.current).toMatchObject({ donnees: 'v1', chargement: true });
		await act(async () => attentes[1]!.resoudre('v2'));
		expect(rendu.result.current).toMatchObject({ donnees: 'v2', chargement: false });
	});

	it('réouverture après reconnexion → rechargée', async () => {
		const { faux, attentes } = monter(true);
		await act(async () => attentes[0]!.resoudre('v1'));
		act(() => faux.connexion.passerA('reconnexion'));
		act(() => faux.connexion.passerA('ouverte'));
		await waitFor(() => expect(attentes).toHaveLength(2));
	});

	it('publierRessource : les données rendues par une écriture remplacent celles des lecteurs, sans nouvelle lecture', async () => {
		const faux = creerFauxClient();
		const attentes: { resoudre(v: string): void }[] = [];
		const charger = () => {
			const d = differe<string>();
			attentes.push(d);
			return d.promesse;
		};
		const wrapper = ({ children }: { children: ReactNode }) => createElement(FournisseurClient, { client: faux.client, children });
		const rendu = renderHook(() => ({ a: useRessource('moteurs', charger), b: useRessource('moteurs', charger), cache: useCacheRessources() }), { wrapper });
		await act(async () => attentes[0]!.resoudre('v1'));
		expect(rendu.result.current.b.donnees).toBe('v1');
		act(() => publierRessource(rendu.result.current.cache, 'moteurs', 'publiee'));
		expect(rendu.result.current.a).toMatchObject({ donnees: 'publiee', chargement: false, erreur: null });
		expect(rendu.result.current.b.donnees).toBe('publiee');
		expect(rendu.result.current.cache.get('moteurs')).toBe('publiee');
		expect(attentes).toHaveLength(1);
	});

	it('lecture en vol puis publication : la publication gagne, la lecture abandonnée ne l’écrase pas', async () => {
		const faux = creerFauxClient();
		const attentes: { resoudre(v: string): void }[] = [];
		const signaux: AbortSignal[] = [];
		const charger = (signal: AbortSignal) => {
			const d = differe<string>();
			attentes.push(d);
			signaux.push(signal);
			return d.promesse;
		};
		const wrapper = ({ children }: { children: ReactNode }) => createElement(FournisseurClient, { client: faux.client, children });
		const rendu = renderHook(() => ({ r: useRessource('moteurs', charger), cache: useCacheRessources() }), { wrapper });
		await act(async () => attentes[0]!.resoudre('v1'));
		act(() => rendu.result.current.r.recharger());
		await waitFor(() => expect(attentes).toHaveLength(2));
		expect(rendu.result.current.r.chargement).toBe(true);
		act(() => publierRessource(rendu.result.current.cache, 'moteurs', 'publiee'));
		expect(signaux[1]!.aborted).toBe(true);
		expect(rendu.result.current.r).toMatchObject({ donnees: 'publiee', chargement: false });
		// la lecture d'avant répond quand même (chargeur qui ignore le signal) : ignorée
		await act(async () => attentes[1]!.resoudre('ancienne'));
		expect(rendu.result.current.r.donnees).toBe('publiee');
		expect(rendu.result.current.cache.get('moteurs')).toBe('publiee');
	});

	it('sans memoire : pas de rechargement ; recharger() recharge', async () => {
		const { faux, attentes, rendu } = monter(false);
		await act(async () => attentes[0]!.resoudre('v1'));
		act(() => faux.connexion.emettre({ type: 'memoire', modifieeMs: 1 }));
		await act(async () => {});
		expect(attentes).toHaveLength(1);
		act(() => rendu.result.current.recharger());
		await waitFor(() => expect(attentes).toHaveLength(2));
	});

	it('clé null → rien chargé', async () => {
		const { attentes, rendu } = monter(true, null);
		await act(async () => {});
		expect(attentes).toHaveLength(0);
		expect(rendu.result.current).toMatchObject({ donnees: undefined, chargement: false });
	});

	it('erreur → message, données gardées ; réponse périmée ignorée', async () => {
		const { faux, attentes, rendu } = monter(true);
		await act(async () => attentes[0]!.resoudre('v1'));
		act(() => faux.connexion.emettre({ type: 'memoire', modifieeMs: 1 }));
		act(() => faux.connexion.emettre({ type: 'memoire', modifieeMs: 2 }));
		await waitFor(() => expect(attentes).toHaveLength(3));
		await act(async () => attentes[2]!.resoudre('v3'));
		await act(async () => attentes[1]!.resoudre('v2'));
		expect(rendu.result.current.donnees).toBe('v3');
	});

	it('erreur → statut HTTP de l’ErreurApi (null pour une autre erreur), remis à null au succès suivant', async () => {
		const faux = creerFauxClient();
		let echec: Error | null = new ErreurApi('Fiche introuvable.', 404);
		const charger = async () => {
			if (echec) throw echec;
			return 'v';
		};
		const wrapper = ({ children }: { children: ReactNode }) => createElement(FournisseurClient, { client: faux.client, children });
		const rendu = renderHook(() => useRessource('fiche', charger, { memoire: true }), { wrapper });
		await waitFor(() => expect(rendu.result.current).toMatchObject({ erreur: 'Fiche introuvable.', statut: 404 }));
		echec = new Error('réseau');
		act(() => rendu.result.current.recharger());
		await waitFor(() => expect(rendu.result.current).toMatchObject({ erreur: 'réseau', statut: null }));
		echec = null;
		act(() => rendu.result.current.recharger());
		await waitFor(() => expect(rendu.result.current).toMatchObject({ donnees: 'v', erreur: null, statut: null }));
	});

	it('changement de clé → nouvelles données, sans montrer celles de l’ancienne clé', async () => {
		const { attentes, rendu } = monter(true, 'a');
		await act(async () => attentes[0]!.resoudre('A'));
		rendu.rerender({ c: 'b' });
		expect(rendu.result.current.donnees).toBeUndefined();
		await act(async () => attentes[1]!.resoudre('B'));
		expect(rendu.result.current.donnees).toBe('B');
	});

	it('abandon (requête remplacée) → ni erreur ni statut affichés, données gardées', async () => {
		const faux = creerFauxClient();
		let n = 0;
		const charger = () => (++n === 1 ? Promise.resolve('v1') : Promise.reject(new DOMException('Requête remplacée par une plus récente.', 'AbortError')));
		const wrapper = ({ children }: { children: ReactNode }) => createElement(FournisseurClient, { client: faux.client, children });
		const rendu = renderHook(() => useRessource('cle', charger, { memoire: true }), { wrapper });
		await waitFor(() => expect(rendu.result.current.donnees).toBe('v1'));
		act(() => rendu.result.current.recharger());
		await waitFor(() => expect(rendu.result.current.chargement).toBe(false));
		expect(rendu.result.current).toMatchObject({ donnees: 'v1', erreur: null, statut: null });
	});
});

describe('useRessource : partage par clé', () => {
	it('l’entrée d’une clé est retirée quand son dernier lecteur part et qu’aucune demande n’est en cours', async () => {
		const faux = creerFauxClient();
		const attentes: { resoudre(v: string): void }[] = [];
		const charger = () => {
			const d = differe<string>();
			attentes.push(d);
			return d.promesse;
		};
		const wrapper = ({ children }: { children: ReactNode }) => createElement(FournisseurClient, { client: faux.client, children });
		const rendu = renderHook(() => ({ r: useRessource('recherche:x', charger), cache: useCacheRessources() }), { wrapper });
		const cache = rendu.result.current.cache;
		act(() => rendu.result.current.r.recharger());
		await waitFor(() => expect(attentes.length).toBeGreaterThan(0));
		await act(async () => attentes.forEach((a) => a.resoudre('v')));
		expect(etatPartage(cache)).toMatchObject({ ecouteurs: 1, demandes: 1 });
		rendu.unmount();
		expect(etatPartage(cache)).toEqual({ ecouteurs: 0, demandes: 0, lectures: 0 });
	});
});
