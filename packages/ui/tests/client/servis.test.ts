// @vitest-environment happy-dom
import type { EntreeServieVue } from '@mnemo/contrat';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { FournisseurClient } from '../../src/client/contexte.tsx';
import { useServis } from '../../src/client/hooks.ts';
import { creerFauxClient } from '../aides/faux-client.tsx';

afterEach(cleanup);

const entree = (ms: number, id: string): EntreeServieVue => ({ session: 's1', moment: 'message', horodatageMs: ms, ids: [id], texte: id, ms: 10, sens: false, classement: [], muet: null, cartes: [] });

describe('useServis', () => {
	it('messages servi gardés pendant un rechargement, sans doublon', async () => {
		const A = entree(1, 'a.md');
		const B = entree(2, 'b.md');
		const C = entree(3, 'c.md');
		let reponse: Promise<EntreeServieVue[]> = Promise.resolve([A]);
		const faux = creerFauxClient({ '/api/sessions/s1/servis': async () => ({ servis: await reponse }) });
		const wrapper = ({ children }: { children: ReactNode }) => createElement(FournisseurClient, { client: faux.client, children });
		const rendu = renderHook(() => useServis('s1'), { wrapper });
		await waitFor(() => expect(rendu.result.current.donnees).toEqual([A]));

		act(() => faux.connexion.emettre({ type: 'servi', entree: B }));
		act(() => faux.connexion.emettre({ type: 'servi', entree: B }));
		expect(rendu.result.current.donnees).toEqual([B, A]);

		let resoudre!: (v: EntreeServieVue[]) => void;
		reponse = new Promise((r) => (resoudre = r));
		act(() => rendu.result.current.recharger());
		act(() => faux.connexion.emettre({ type: 'servi', entree: C }));
		await act(async () => resoudre([B, A]));
		expect(rendu.result.current.donnees).toEqual([C, B, A]);

		act(() => faux.connexion.emettre({ type: 'servi', entree: { ...entree(4, 'd.md'), session: 'autre' } }));
		expect(rendu.result.current.donnees).toHaveLength(3);
	});

	it('une entrée rediffusée (même horodatage, classement noté) remplace la précédente, qu’elle vienne du service ou d’un message', async () => {
		const A = entree(1, 'a.md');
		const B = entree(2, 'b.md');
		const faux = creerFauxClient({ '/api/sessions/s1/servis': { servis: [A] } });
		const wrapper = ({ children }: { children: ReactNode }) => createElement(FournisseurClient, { client: faux.client, children });
		const rendu = renderHook(() => useServis('s1'), { wrapper });
		await waitFor(() => expect(rendu.result.current.donnees).toEqual([A]));
		const notee = (e: EntreeServieVue): EntreeServieVue => ({ ...e, classement: [{ id: e.ids[0]!, titre: 'T', note: 0.8, servi: true, rang: 1 }] });
		act(() => faux.connexion.emettre({ type: 'servi', entree: notee(A) }));
		expect(rendu.result.current.donnees).toEqual([notee(A)]);
		act(() => faux.connexion.emettre({ type: 'servi', entree: B }));
		act(() => faux.connexion.emettre({ type: 'servi', entree: notee(B) }));
		expect(rendu.result.current.donnees).toEqual([notee(B), notee(A)]);
	});
});
