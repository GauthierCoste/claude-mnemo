// @vitest-environment happy-dom
import type { SessionVue } from '@mnemo/contrat';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Application } from '../../src/composants/Application.tsx';
import { creerFauxClient } from '../aides/faux-client.tsx';

// Terminal simulé : le tiroir de l'archiviste ouvert n'instancie pas xterm.
vi.mock('../../src/terminal/Terminal.tsx', () => ({ Terminal: (p: { session: string }) => <textarea aria-label={`terminal ${p.session}`} readOnly /> }));

afterEach(cleanup);

function session(id: string, etat: SessionVue['etat'], profil = 'travail'): SessionVue {
	return { id, profil, dossier: 'erp-saas', position: 'projets/erp-saas', projet: 'erp-saas', objectif: `Objectif ${id}`, etat, creeeMs: 1, majMs: 1, bilanDemandeMs: null, commitDebut: null, branche: 'main', terminal: true, dialogueOuvert: false, dossierNonRattache: null, niveauModeles: null };
}

const REPONSES = {
	'/api/sessions': { sessions: [] },
	'/api/sante': { ok: true, pid: 1, racine: '~/Developer', racineAbsolue: '/Users/ana/Developer', terminaux: { ok: true }, version: '0.1.0' },
	'/api/fil': { commits: [], aConfirmer: [{ id: 'a', chemin: 'x.md', texte: 't', contexte: '', date: null }], montees: [], modifications: [] },
	'/api/memoire/graphe': { coffre: '_mnemo', fiches: [], liens: [], notions: [], sens: { disponible: false, etat: 'absent' }, modifieeMs: 0 },
	'/api/memoire/documents': { documents: [], aTraiter: [{ chemin: 'sources/claude-code/n.md', titre: 'N', document: null, date: '2026-11-22', aTraiter: true }], totalDocuments: 0, totalATraiter: 1 },
};

describe('Application', () => {
	it('barre de titre sans faux boutons de fenêtre', () => {
		const faux = creerFauxClient(REPONSES);
		const { container } = render(<Application client={faux.client} />);
		const titre = container.querySelector('header')!;
		expect(titre.querySelectorAll('i')).toHaveLength(0);
		const logo = within(titre).getByRole('img', { name: 'Mnemo' });
		expect(titre.firstElementChild).toBe(logo);
		expect(logo.getAttribute('src')).toMatch(/icone\.svg$/u);
	});

	it('sans jeton → écran du jeton', () => {
		render(<Application client={null} />);
		expect(screen.getByText(/Jeton absent ou périmé/)).toBeTruthy();
		expect(screen.queryByRole('navigation')).toBeNull();
	});

	it('avec un client → navigation (Sessions, Mémoire ; plus de Fil), pastille « 2 » quand deux sessions attendent, éléments à faire sur Mémoire', async () => {
		const faux = creerFauxClient(REPONSES);
		render(<Application client={faux.client} />);
		const nav = screen.getByRole('navigation');
		expect(within(nav).getByRole('button', { name: /Sessions/ })).toBeTruthy();
		expect(within(nav).getByRole('button', { name: /Mémoire/ })).toBeTruthy();
		expect(within(nav).queryByRole('button', { name: /Fil/ })).toBeNull();
		await act(async () => {
			faux.connexion.emettre({ type: 'sessions', sessions: [session('a', 'attend'), session('b', 'travaille'), session('c', 'attend'), session('d', 'attend', 'archiviste')] });
		});
		expect(within(nav).getByRole('button', { name: /Sessions/ }).textContent).toContain('2');
		await act(async () => faux.connexion.emettre({ type: 'session', session: session('b', 'attend') }));
		expect(within(nav).getByRole('button', { name: /Sessions/ }).textContent).toContain('3');
		// 1 fait à confirmer + 1 source à traiter
		expect(within(nav).getByRole('button', { name: /Mémoire/ }).textContent).toContain('2');
	});

	it('l’archiviste qui attend une réponse (dialogue ouvert) : signalé sur son bouton et dans son tiroir ; au repos après un arrêt, non', async () => {
		const faux = creerFauxClient(REPONSES);
		render(<Application client={faux.client} />);
		const bouton = screen.getByRole('button', { name: /Archiviste/ });
		await act(async () => faux.connexion.emettre({ type: 'sessions', sessions: [session('d', 'travaille', 'archiviste')] }));
		expect(bouton.textContent).not.toContain('attend une réponse');
		// repos après `arret` : état `attend`, aucun dialogue
		await act(async () => faux.connexion.emettre({ type: 'session', session: session('d', 'attend', 'archiviste') }));
		expect(bouton.textContent).not.toContain('attend une réponse');
		await act(async () => fireEvent.click(bouton));
		const tiroir = screen.getByRole('complementary', { name: 'Archiviste' });
		expect(within(tiroir).queryByText('attend une réponse')).toBeNull();
		await act(async () => faux.connexion.emettre({ type: 'session', session: { ...session('d', 'attend', 'archiviste'), dialogueOuvert: true } }));
		expect(bouton.textContent).toContain('attend une réponse');
		expect(within(tiroir).getByText('attend une réponse')).toBeTruthy();
		expect(within(screen.getByRole('navigation')).getByRole('button', { name: /Sessions/ }).textContent).not.toMatch(/\d/);
	});

	it('connexion en reconnexion → bandeau ; jeton refusé → écran du jeton', async () => {
		const faux = creerFauxClient(REPONSES);
		render(<Application client={faux.client} />);
		await act(async () => faux.connexion.passerA('reconnexion'));
		expect(screen.getByText(/Service arrêté — reconnexion/)).toBeTruthy();
		await act(async () => faux.connexion.passerA('ouverte'));
		expect(screen.queryByText(/Service arrêté — reconnexion/)).toBeNull();
		await act(async () => faux.connexion.passerA('jeton_refuse'));
		expect(screen.getByText(/Jeton absent ou périmé/)).toBeTruthy();
	});

	it('401 de l’API → écran du jeton', async () => {
		const faux = creerFauxClient(REPONSES);
		render(<Application client={faux.client} />);
		await act(async () => faux.refuserJeton());
		expect(screen.getByText(/Jeton absent ou périmé/)).toBeTruthy();
	});

	it('navigation entre les vues et raccourcis ⌥A / Échap', async () => {
		const faux = creerFauxClient(REPONSES);
		render(<Application client={faux.client} />);
		const nav = screen.getByRole('navigation');
		const memoire = within(nav).getByRole('button', { name: /Mémoire/ });
		await act(async () => memoire.click());
		expect(memoire.getAttribute('aria-current')).toBe('page');
		const tiroir = document.querySelector<HTMLElement>('aside[data-ouvert][aria-label="Archiviste"]')!;
		expect(within(nav).getByRole('button', { name: /Sessions/ }).getAttribute('aria-keyshortcuts')).toBe('Alt+0');
		expect(within(tiroir).getByRole('button', { name: 'Fermer', hidden: true }).getAttribute('aria-keyshortcuts')).toBe('Escape');
		expect(tiroir.getAttribute('data-ouvert')).toBe('false');
		await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', key: 'æ', altKey: true })));
		expect(tiroir.getAttribute('data-ouvert')).toBe('true');
		await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' })));
		expect(tiroir.getAttribute('data-ouvert')).toBe('false');
		await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '1', altKey: true })));
		expect(within(nav).getByRole('button', { name: /Sessions/ }).getAttribute('aria-current')).toBe('page');
	});

	it('⌥, depuis un champ : rien (le caractère s’écrit) ; depuis la page : Réglages ; ⌘K depuis un champ : palette', async () => {
		const faux = creerFauxClient(REPONSES);
		render(<Application client={faux.client} />);
		const vue = () => screen.getByRole('main').getAttribute('data-vue');
		const champ = document.createElement('input');
		document.body.append(champ);
		const altVirgule = { code: 'Comma', key: '…', altKey: true };
		expect(fireEvent.keyDown(champ, altVirgule)).toBe(true);
		expect(vue()).toBe('sessions');
		let annulee = false;
		await act(async () => {
			annulee = !fireEvent.keyDown(document.body, altVirgule);
		});
		expect(annulee).toBe(true);
		expect(vue()).toBe('reglages');
		await act(async () => fireEvent.keyDown(champ, { code: 'KeyK', key: 'k', metaKey: true }));
		expect(screen.getByRole('combobox', { name: 'Palette' })).toBeTruthy();
		champ.remove();
	});
});
