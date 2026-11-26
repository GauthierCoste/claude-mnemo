// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Documentation } from '../../src/composants/reglages/documentation/Documentation.tsx';
import { HOOKS_PROFIL } from '../../src/profils/hooks.ts';
import { SECTIONS_DOC } from '../../src/reglages/documentation.ts';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

const sommaire = () => within(screen.getByRole('navigation', { name: 'Sommaire' })).getAllByRole('button');
const actif = () => sommaire().filter((a) => a.getAttribute('aria-current') === 'true').map((a) => a.textContent);
const TITRES = ['Principe', 'Session', 'Agents', 'Rappel', 'Recherche', 'Confiance', 'Archiviste'];

/** Tout le texte du contenu, gras et code compris. */
const texteDuContenu = (): string => {
	const morceaux: string[] = [];
	const parcourir = (v: unknown, cle = ''): void => {
		if (typeof v === 'string') {
			if (!['genre', 'id'].includes(cle)) morceaux.push(v);
		} else if (Array.isArray(v)) v.forEach((x) => parcourir(x, cle));
		else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) parcourir(x, k);
	};
	parcourir(SECTIONS_DOC);
	return morceaux.join('\n');
};

describe('onglet Documentation', () => {
	it('une seule page : toutes les sections rendues, titres h2, sommaire dans l’ordre, la première marquée', () => {
		render(<Documentation />);
		expect(sommaire().map((a) => a.textContent)).toEqual(TITRES);
		expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(TITRES);
		expect(sommaire()[0]!.getAttribute('aria-controls')).toBe('doc-principe');
		expect(actif()).toEqual(['Principe']);
	});

	it('sommaire → section : défilement doux, focus sur le titre, section marquée ; mouvement réduit : sans animation', async () => {
		const defiler = vi.fn();
		HTMLElement.prototype.scrollIntoView = defiler;
		render(<Documentation />);
		await act(async () => sommaire()[5]!.click());
		expect(defiler).toHaveBeenLastCalledWith({ behavior: 'smooth', block: 'start' });
		expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Confiance' }));
		expect(actif()).toEqual(['Confiance']);
		vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }));
		await act(async () => sommaire()[1]!.click());
		expect(defiler).toHaveBeenLastCalledWith({ behavior: 'auto', block: 'start' });
		expect(actif()).toEqual(['Session']);
	});

	it('pendant le défilement, la section visible est marquée dans le sommaire', () => {
		render(<Documentation />);
		const page = document.getElementById('doc-principe')!.parentElement!;
		const hauts: Record<string, number> = { 'doc-principe': -600, 'doc-session': -300, 'doc-agents': 20, 'doc-rappel': 400 };
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
			const top = this === page ? 0 : (hauts[this.id] ?? 2000);
			return { top, bottom: top + 100, left: 0, right: 0, width: 0, height: 100, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
		});
		fireEvent.scroll(page);
		expect(actif()).toEqual(['Agents']);
	});

	it('Session : tableau des capacités (capacité, hook, effet, réglable) aligné sur l’onglet Agents', () => {
		render(<Documentation />);
		const tableau = screen.getByRole('table', { name: /Capacités et hooks/u });
		expect(within(tableau).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Capacité', 'Hook', 'Effet', 'Réglable']);
		const lignes = within(tableau).getAllByRole('row').slice(1);
		expect(lignes.map((l) => within(l).getByRole('rowheader').textContent?.trim().slice(2))).toEqual(HOOKS_PROFIL.map((h) => h.capacite));
		expect(lignes.map((l) => l.querySelector('code')?.textContent)).toEqual(['debut', 'message', 'outil', 'apres_outil', 'arret', 'fin']);
		expect(lignes.map((l) => l.lastElementChild?.textContent)).toEqual(['non, toujours actif', 'oui', 'oui', 'oui', 'non, toujours actif', 'non, toujours actif']);
	});

	it('contenu clé : valeurs par défaut, chemins de fichiers, outils MCP ; tableaux avec en-têtes', () => {
		render(<Documentation />);
		const rappel = screen.getByRole('table', { name: /Mémoire › Rappel/u });
		expect(within(within(rappel).getByRole('rowheader', { name: 'Seuil d’injection' }).closest('tr')!).getByText('90 %')).toBeTruthy();
		const sources = screen.getByRole('table', { name: /Fiabilité par source/u });
		expect(within(sources).getByRole('row', { name: /email.*0,7/u })).toBeTruthy();
		for (const table of screen.getAllByRole('table')) expect(within(table).getAllByRole('columnheader').length).toBeGreaterThan(1);
		const tout = texteDuContenu();
		for (const attendu of ['`_mnemo/skills/<nom>/SKILL.md`', '`metadata.icone`', '`chercher`', '`proposer`', '`lire`', '`montant`', '`verifiee`', 'Réglages › Mémoire › Recherche', 'Agents › Capacités'])
			expect(tout).toContain(attendu);
	});

	it('vocabulaire : registre neutre (ni tu ni vous), jamais « servir » ni « nourrir », chemins de l’interface à jour', () => {
		const tout = texteDuContenu();
		expect(tout).not.toMatch(/\b(?:tu|te|toi|ton|ta|tes|vous|votre|vos)\b|\bt’|\bt'/iu);
		expect(tout).not.toMatch(/\bserv(?:ir|ie|ies|i|is|ent)\b|nourri/iu);
		expect(tout).not.toMatch(/App Claude ›|Profils ›|Système ›|Pouvoirs/u);
		for (const chemin of tout.match(/Réglages › [A-ZÉ][a-zé]+(?: › [A-ZÉ][a-zé]+)?/gu) ?? [])
			expect(['Réglages › Branchements', 'Réglages › Mémoire › Rappel', 'Réglages › Mémoire › Recherche', 'Réglages › Mémoire › Confiance', 'Réglages › Système']).toContain(chemin);
	});
});
