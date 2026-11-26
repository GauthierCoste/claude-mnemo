// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Documentation } from '../../src/composants/reglages/documentation/Documentation.tsx';
import { HOOKS_PROFIL } from '../../src/profils/hooks.ts';
import { CHAPITRES_DOC } from '../../src/reglages/documentation.ts';
import { stockage } from '../aides/stockage.ts';

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const chapitres = () => within(screen.getByRole('navigation', { name: 'Chapitres' })).getAllByRole('button');

describe('onglet Documentation', () => {
	it('six chapitres dans le panneau, le premier ouvert ; un autre s’ouvre au clic et reste retenu', async () => {
		const valeurs = stockage();
		render(<Documentation />);
		expect(chapitres().map((b) => b.querySelector('span span')?.textContent)).toEqual(['Le principe', 'Une session', 'Les agents', 'Le rappel', 'La confiance', 'L’archiviste']);
		expect(chapitres()[0]!.getAttribute('aria-current')).toBe('true');
		expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Le principe');
		await act(async () => chapitres()[4]!.click());
		expect(screen.getByRole('article', { name: 'La confiance' })).toBeTruthy();
		expect(chapitres()[4]!.getAttribute('aria-current')).toBe('true');
		expect(chapitres()[0]!.getAttribute('aria-current')).toBeNull();
		expect(valeurs.get('mnemo.reglages.chapitre')).toBe('confiance');
		cleanup();
		render(<Documentation />);
		expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('La confiance');
	});

	it('un chapitre retenu inconnu ou un stockage indisponible : le premier chapitre', () => {
		stockage().set('mnemo.reglages.chapitre', 'disparu');
		render(<Documentation />);
		expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Le principe');
		cleanup();
		vi.stubGlobal('localStorage', {
			getItem: () => {
				throw new Error('bloqué');
			},
			setItem: () => {
				throw new Error('bloqué');
			},
		});
		render(<Documentation />);
		expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Le principe');
	});

	it('Une session : la frise des six capacités, avec leurs noms de l’onglet Agents, dans l’ordre', async () => {
		stockage().set('mnemo.reglages.chapitre', 'session');
		render(<Documentation />);
		const frise = screen.getByRole('list', { name: 'Les six capacités, dans l’ordre de la session' });
		const etapes = within(frise).getAllByRole('listitem');
		expect(etapes.map((li) => li.querySelector('b')?.textContent)).toEqual(HOOKS_PROFIL.map((h) => h.capacite));
		expect(HOOKS_PROFIL.map((h) => h.capacite)).toEqual(['Éveil', 'Souffle', 'Bouclier', 'Carnet', 'Veille', 'Récit']);
		expect(etapes[4]!.textContent).toContain('en attente de réponse');
	});

	it('gras et code rendus ; jamais « servir » ni « nourrir » dans le contenu ; chemins des nouveaux Réglages', async () => {
		stockage().set('mnemo.reglages.chapitre', 'agents');
		render(<Documentation />);
		expect(screen.getByText('lié à Mnemo').tagName).toBe('B');
		expect(screen.getByText('_mnemo/skills/').tagName).toBe('CODE');
		const tout = JSON.stringify(CHAPITRES_DOC);
		expect(tout).not.toMatch(/\bserv(?:ir|ie|ies|i|is|ent)\b|nourri/iu);
		expect(tout).not.toMatch(/App Claude ›|Profils ›|Système ›/u);
		for (const chemin of tout.match(/Réglages › [A-ZÉ][a-zé]+/gu) ?? []) expect(['Réglages › Branchements', 'Réglages › Mémoire', 'Réglages › Système']).toContain(chemin);
	});
});
