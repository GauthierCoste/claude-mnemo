// @vitest-environment happy-dom
import { PROFIL_ARCHIVISTE, PROFIL_TRAVAIL } from '@mnemo/commun';
import type { SessionVue } from '@mnemo/contrat';
import { act, cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentsEnCours, agentsEnCours, AGENTS_VISIBLES, libelleAgent } from '../../src/composants/sessions/AgentsEnCours.tsx';
import { creerFauxClient, rendreAvecClient } from '../aides/faux-client.tsx';

afterEach(cleanup);

/** Une session réduite à ce que la rangée lit. */
const x = (id: string, profil: string, etat: SessionVue['etat'], majMs = 1) => ({ id, profil, etat, majMs }) as SessionVue;

const PROFILS = { profils: [{ nom: 'redaction' }, { nom: PROFIL_ARCHIVISTE }, { nom: PROFIL_TRAVAIL }].map((p) => ({ ...p, avatar: { forme: 'robot', couleur: 'vert' } })), ignores: [], avertissements: [] };

function monter(sessions: SessionVue[]) {
	const surAgent = vi.fn();
	rendreAvecClient(<AgentsEnCours sessions={sessions} surAgent={surAgent} />, creerFauxClient({ '/api/profils': PROFILS }).client);
	return surAgent;
}
const agents = () => within(screen.getByRole('list', { name: 'Agents en cours' })).getAllByRole('button');

describe('agents en cours', () => {
	it('un agent par profil ayant une session vivante, dans l’ordre des profils, sans l’archiviste (son bouton le montre) ; l’état le plus urgent et la session qui le porte', () => {
		const liste = agentsEnCours(
			[x('a', PROFIL_ARCHIVISTE, 'travaille'), x('t1', PROFIL_TRAVAIL, 'en_pause', 9), x('t2', PROFIL_TRAVAIL, 'travaille'), x('t3', PROFIL_TRAVAIL, 'attend'), x('r', 'redaction', 'terminee'), x('v', 'veille', 'a_relire')],
			['redaction', PROFIL_ARCHIVISTE, PROFIL_TRAVAIL],
		);
		expect(liste.map((a) => [a.profil, a.etat, a.session])).toEqual([
			[PROFIL_TRAVAIL, 'attend', 't3'],
			['veille', 'repos', 'v'],
		]);
		expect(libelleAgent(liste[0]!)).toBe('travail : 3 sessions, 1 travaille, 1 attend une réponse, 1 au repos');
		expect(libelleAgent(liste[1]!)).toBe('veille : 1 session, 1 au repos');
		// au repos : la plus récemment active
		expect(agentsEnCours([x('p1', PROFIL_TRAVAIL, 'en_pause', 1), x('p2', PROFIL_TRAVAIL, 'en_pause', 5)], [])[0]!.session).toBe('p2');
	});

	it('rangée : nom accessible neutre, état sur l’avatar (`data-etat`), nombre de sessions ; un clic va à la plus urgente', async () => {
		const surAgent = monter([x('t1', PROFIL_TRAVAIL, 'travaille'), x('t2', PROFIL_TRAVAIL, 'attend'), x('a', PROFIL_ARCHIVISTE, 'travaille')]);
		await act(async () => {});
		// l'archiviste n'a pas d'avatar dans la rangée
		expect(agents()).toHaveLength(1);
		const [travail] = agents() as [HTMLElement];
		expect(travail.getAttribute('aria-label')).toBe('travail : 2 sessions, 1 travaille, 1 attend une réponse');
		expect(travail.dataset['etat']).toBe('attend');
		expect(travail.textContent).toBe('2');
		await act(async () => travail.click());
		expect(surAgent).toHaveBeenCalledWith('t2', PROFIL_TRAVAIL);
	});

	it('aucune session vivante : rien ; au-delà de la place, « +N » qui nomme les autres', async () => {
		monter([x('t', PROFIL_TRAVAIL, 'terminee')]);
		await act(async () => {});
		expect(screen.queryByRole('list', { name: 'Agents en cours' })).toBeNull();
		cleanup();
		const noms = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'];
		monter(noms.map((n) => x(n, n, 'travaille')));
		await act(async () => {});
		expect(agents()).toHaveLength(AGENTS_VISIBLES - 1);
		const plus = screen.getByText('+3').closest('li')!;
		expect(plus.textContent).toContain('Et 3 autres : a5 : 1 session, 1 travaille');
	});
});
