// @vitest-environment happy-dom
import { PROFIL_ARCHIVISTE, PROFIL_TRAVAIL } from '@mnemo/commun';
import type { SessionVue } from '@mnemo/contrat';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lireSessionDuFragment } from '../../src/client/fragment.ts';
import { lireJeton } from '../../src/client/jeton.ts';
import { Application } from '../../src/composants/Application.tsx';
import { ATTENTE_SESSION_MS } from '../../src/composants/sessions/session-de-l-adresse.ts';
import { creerFauxClient } from '../aides/faux-client.tsx';

// Terminal simulé : `data-actif` dit la session choisie.
vi.mock('../../src/terminal/Terminal.tsx', () => ({
	Terminal: (p: { session: string; actif: boolean }) => <textarea aria-label={`terminal ${p.session}`} data-actif={String(p.actif)} readOnly />,
}));

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	history.replaceState(null, '', '/');
});

const J = 'c'.repeat(64);

function session(id: string, dossier: string, e: Partial<SessionVue> = {}): SessionVue {
	return {
		id,
		profil: PROFIL_TRAVAIL,
		dossier,
		position: `projets/${dossier}`,
		projet: dossier,
		objectif: `Objectif ${id}`,
		etat: 'travaille',
		creeeMs: 1,
		majMs: 1,
		bilanDemandeMs: null,
		commitDebut: null,
		branche: 'main',
		terminal: true,
		dialogueOuvert: false,
		dossierNonRattache: null,
		...e,
	};
}

const SESSIONS = [session('s1', 'erp-saas'), session('s2', 'erp-saas'), session('s3', 'api'), session('arch', '', { profil: PROFIL_ARCHIVISTE })];

/** `/api/sessions` sans réponse : la liste n'arrive que par le WebSocket (`emettre`). */
function monter(sessionInitiale: string | null = null) {
	const faux = creerFauxClient({
		'/api/sessions': () => new Promise(() => {}),
		'/api/sante': { ok: true, pid: 1, racine: '~/Developer', racineAbsolue: '/Users/ana/Developer', terminaux: { ok: true }, version: '0.1.0' },
		'/api/fil': { commits: [], aConfirmer: [], montees: [], modifications: [] },
		'/api/memoire/graphe': { coffre: '_mnemo', fiches: [], liens: [], notions: [], sens: { disponible: false, etat: 'absent' }, modifieeMs: 0 },
		'/api/sessions/s1/servis': { servis: [] },
		'/api/sessions/s2/servis': { servis: [] },
		'/api/sessions/s3/servis': { servis: [] },
	});
	render(<Application client={faux.client} session={sessionInitiale} />);
	return faux;
}

const emettreListe = (faux: ReturnType<typeof monter>, sessions = SESSIONS) => act(async () => faux.connexion.emettre({ type: 'sessions', sessions }));
const actif = (id: string) => screen.getByLabelText(`terminal ${id}`).getAttribute('data-actif');
const tiroir = () => document.querySelector<HTMLElement>('aside[data-ouvert][aria-label="Archiviste"]')!;

/** Ce que fait l'app de bureau, fenêtre ouverte : elle change le fragment ; l'événement suit. */
async function changerFragment(fragment: string): Promise<void> {
	history.replaceState(null, '', `/${fragment}`);
	await act(async () => window.dispatchEvent(new HashChangeEvent('hashchange')));
}

describe('lireSessionDuFragment', () => {
	it('seule, avant ou après le jeton ; le jeton se lit toujours à côté', () => {
		expect(lireSessionDuFragment('#session=s3')).toBe('s3');
		expect(lireSessionDuFragment(`#jeton=${J}&session=s3`)).toBe('s3');
		expect(lireSessionDuFragment(`#session=s3&jeton=${J}`)).toBe('s3');
		expect(lireJeton(`#session=s3&jeton=${J}`, null)).toBe(J);
		expect(lireJeton(`#jeton=${J}&session=s3`, null)).toBe(J);
	});

	it('absente, vide ou trop longue → null', () => {
		expect(lireSessionDuFragment('')).toBeNull();
		expect(lireSessionDuFragment(`#jeton=${J}`)).toBeNull();
		expect(lireSessionDuFragment('#session=')).toBeNull();
		expect(lireSessionDuFragment('#session=%20')).toBeNull();
		expect(lireSessionDuFragment(`#session=${'x'.repeat(201)}`)).toBeNull();
	});
});

describe('session demandée par l’adresse', () => {
	it('au chargement (`#session=s3`) : attendue jusqu’à la liste du WebSocket, puis choisie comme par un clic', async () => {
		const faux = monter('s3');
		await emettreListe(faux);
		expect(actif('s3')).toBe('true');
		expect(actif('s1')).toBe('false');
		expect(within(screen.getByRole('complementary', { name: 'Contexte' })).getByText('Objectif s3')).toBeTruthy();
	});

	it('`hashchange` : la session choisie, la vue Sessions affichée, le fragment effacé', async () => {
		const faux = monter();
		await emettreListe(faux);
		expect(actif('s1')).toBe('true');
		await act(async () => within(screen.getByRole('navigation')).getByRole('button', { name: /Mémoire/ }).click());
		expect(document.querySelector('main')!.getAttribute('data-vue')).toBe('memoire');
		await changerFragment('#session=s2');
		expect(document.querySelector('main')!.getAttribute('data-vue')).toBe('sessions');
		expect(actif('s2')).toBe('true');
		expect(location.hash).toBe('');
		expect(location.pathname).toBe('/');
		// une deuxième demande remplace la première
		await changerFragment('#session=s3');
		expect(actif('s3')).toBe('true');
	});

	it('combinée avec le jeton, dans les deux ordres : la session choisie, tout le fragment effacé', async () => {
		const faux = monter();
		await emettreListe(faux);
		await changerFragment(`#jeton=${J}&session=s3`);
		expect(actif('s3')).toBe('true');
		expect(location.hash).toBe('');
		await changerFragment(`#session=s2&jeton=${J}`);
		expect(actif('s2')).toBe('true');
		expect(location.hash).toBe('');
	});

	it('l’archiviste : hors de la grille, son tiroir s’ouvre', async () => {
		const faux = monter('arch');
		expect(tiroir().getAttribute('data-ouvert')).toBe('false');
		await emettreListe(faux);
		expect(tiroir().getAttribute('data-ouvert')).toBe('true');
		expect(actif('s1')).toBe('true');
	});

	it('inconnue : rien ne change, sans erreur ; apparue peu après (message `session`), choisie ; oubliée passé le délai', async () => {
		vi.useFakeTimers();
		const faux = monter('s9');
		await emettreListe(faux);
		expect(actif('s1')).toBe('true');
		expect(document.querySelector('main')!.getAttribute('data-vue')).toBe('sessions');
		// créée juste après la demande : son message suit la liste
		await act(async () => faux.connexion.emettre({ type: 'session', session: session('s9', 'api') }));
		expect(actif('s9')).toBe('true');

		await changerFragment('#session=s8');
		expect(location.hash).toBe('');
		await act(async () => vi.advanceTimersByTime(ATTENTE_SESSION_MS));
		await act(async () => faux.connexion.emettre({ type: 'session', session: session('s8', 'api') }));
		expect(actif('s8')).toBe('false');
		expect(actif('s9')).toBe('true');
	});

	it('fragment sans session (`#autre=1`) : effacé, rien d’autre', async () => {
		const faux = monter();
		await emettreListe(faux);
		await changerFragment('#autre=1');
		expect(location.hash).toBe('');
		expect(actif('s1')).toBe('true');
	});
});
