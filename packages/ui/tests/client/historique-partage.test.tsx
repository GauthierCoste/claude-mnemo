// @vitest-environment happy-dom
import type { SessionVue } from '@mnemo/contrat';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Application } from '../../src/composants/Application.tsx';
import { creerFauxClient } from '../aides/faux-client.tsx';

vi.mock('../../src/terminal/Terminal.tsx', () => ({ Terminal: (p: { session: string }) => <textarea aria-label={`terminal ${p.session}`} readOnly /> }));

afterEach(cleanup);

function session(id: string, etat: SessionVue['etat']): SessionVue {
	return { id, profil: 'travail', dossier: 'erp-saas', position: 'projets/erp-saas', projet: 'erp-saas', objectif: `Objectif ${id}`, etat, creeeMs: 1, majMs: 1, bilanDemandeMs: null, commitDebut: null, branche: 'main', terminal: true, dialogueOuvert: false, dossierNonRattache: null };
}

const attendre = () => act(async () => new Promise((r) => setTimeout(r, 50)));

describe('historique : une ressource partagée par toutes les vues', () => {
	it('au démarrage, une seule lecture de /api/historique, quel que soit le nombre de vues ; une fin de session → une seule relecture', async () => {
		const faux = creerFauxClient({
			'/api/sessions': { sessions: [session('a', 'travaille'), session('b', 'terminee')] },
			'/api/historique': { sessions: [] },
			'/api/sante': { ok: true, pid: 1, racine: '~/Developer', racineAbsolue: '/Users/ana/Developer', terminaux: { ok: true }, version: '0.1.0' },
			'/api/fil': { commits: [], aConfirmer: [], montees: [], modifications: [] },
			'/api/memoire/graphe': { coffre: '_mnemo', fiches: [], liens: [], notions: [], sens: { disponible: false, etat: 'absent' }, modifieeMs: 0 },
			'/api/memoire/documents': { documents: [], aTraiter: [], totalDocuments: 0, totalATraiter: 0 },
		});
		const historique = () => faux.api.lire.mock.calls.filter(([chemin]) => chemin === '/api/historique').length;
		render(<Application client={faux.client} />);
		await attendre();
		await act(async () => faux.connexion.emettre({ type: 'sessions', sessions: [session('a', 'travaille'), session('b', 'terminee')] }));
		await attendre();
		expect(historique()).toBe(1);
		await act(async () => faux.connexion.emettre({ type: 'session', session: session('a', 'terminee') }));
		await attendre();
		expect(historique()).toBe(2);
	});
});
