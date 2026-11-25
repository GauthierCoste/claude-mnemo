// @vitest-environment happy-dom
import { ROUTES, type EtatModelesVue } from '@mnemo/contrat';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { FournisseurClient } from '../../src/client/contexte.tsx';
import { useModeles } from '../../src/client/hooks.ts';
import { creerFauxClient } from '../aides/faux-client.tsx';

afterEach(cleanup);

const vue = (e: Partial<EtatModelesVue> = {}): EtatModelesVue => ({
	installes: true,
	niveau: 'complets',
	gardien: 'arrete',
	inactiviteMinutes: null,
	sens: 'arrete',
	reranker: 'arrete',
	pieces: { sens: null, reranker: null, moteur: null },
	activites: [],
	...e,
});

describe('useModeles', () => {
	it('lu au service, puis tenu par les messages `modeles` (l’accueil d’une reconnexion compris)', async () => {
		const faux = creerFauxClient({ [ROUTES.modeles]: vue() });
		const wrapper = ({ children }: { children: ReactNode }) => createElement(FournisseurClient, { client: faux.client, children });
		const rendu = renderHook(() => useModeles(true), { wrapper });
		await waitFor(() => expect(rendu.result.current.etat).toEqual(vue()));
		act(() => faux.connexion.emettre({ type: 'modeles', modeles: vue({ gardien: 'pret' }) }));
		expect(rendu.result.current.etat?.gardien).toBe('pret');
		act(() => faux.connexion.emettre({ type: 'modeles', modeles: vue({ gardien: 'echec' }) }));
		expect(rendu.result.current.etat?.gardien).toBe('echec');
	});

	it('la réponse d’un geste n’écrase pas une diffusion arrivée depuis son envoi ; sans diffusion, elle s’applique', async () => {
		let resoudre!: (v: EtatModelesVue) => void;
		const faux = creerFauxClient({
			[ROUTES.modeles]: vue(),
			[`PUT ${ROUTES.modelesNiveau}`]: () => new Promise<EtatModelesVue>((r) => (resoudre = r)),
			[ROUTES.modelesArreter]: { ...vue({ gardien: 'arrete' }), arret: { enChargement: 1 } },
		});
		const wrapper = ({ children }: { children: ReactNode }) => createElement(FournisseurClient, { client: faux.client, children });
		const rendu = renderHook(() => useModeles(true), { wrapper });
		await waitFor(() => expect(rendu.result.current.etat).toEqual(vue()));
		let geste!: Promise<unknown>;
		act(() => {
			geste = rendu.result.current.changerNiveau('sens');
		});
		// pendant le geste, une diffusion plus récente (le niveau, puis l'arrêt qu'il a causé)
		act(() => faux.connexion.emettre({ type: 'modeles', modeles: vue({ niveau: 'sens', reranker: 'exclu' }) }));
		await act(async () => {
			resoudre(vue({ niveau: 'sens', gardien: 'pret' }));
			await geste;
		});
		expect(rendu.result.current.etat).toEqual(vue({ niveau: 'sens', reranker: 'exclu' }));
		let arret: unknown;
		await act(async () => {
			arret = await rendu.result.current.arreter();
		});
		expect(arret).toEqual({ enChargement: 1 });
		expect(rendu.result.current.etat?.gardien).toBe('arrete');
	});
});
