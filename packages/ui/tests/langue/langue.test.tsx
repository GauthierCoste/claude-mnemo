// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LangueFournie, useTextes } from '../../src/langue/langue.tsx';
import { TEXTES } from '../../src/langue/textes.ts';
import { stockage } from '../aides/stockage.ts';

function Bouton() {
	return <button type="button">{useTextes().commun.actions.annuler}</button>;
}

let retenu: Map<string, string>;
beforeEach(() => {
	retenu = stockage();
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('langue de l’interface', () => {
	it('hors de LangueFournie : le français, la référence', () => {
		render(<Bouton />);
		expect(screen.getByRole('button').textContent).toBe('Annuler');
	});

	it('réglage en : l’anglais, posé sur <html lang> et retenu pour le prochain chargement', () => {
		render(
			<LangueFournie reglage="en">
				<Bouton />
			</LangueFournie>,
		);
		expect(screen.getByRole('button').textContent).toBe('Cancel');
		expect(document.documentElement.lang).toBe('en');
		expect(retenu.get('mnemo.langue')).toBe('en');
	});

	it('réglage pas encore lu : la dernière langue retenue, sinon celle du navigateur', () => {
		render(
			<LangueFournie>
				<Bouton />
			</LangueFournie>,
		);
		expect(screen.getByRole('button').textContent).toBe('Annuler');
		cleanup();
		retenu.set('mnemo.langue', 'en');
		render(
			<LangueFournie>
				<Bouton />
			</LangueFournie>,
		);
		expect(screen.getByRole('button').textContent).toBe('Cancel');
	});

	it('formats : pluriels et nombres selon la langue', () => {
		expect(TEXTES.fr.commun.formats.fiches(0)).toBe('0 fiche');
		expect(TEXTES.en.commun.formats.fiches(0)).toBe('0 notes');
		expect(TEXTES.en.commun.formats.fiches(1)).toBe('1 note');
		expect(TEXTES.fr.commun.formats.taille(1536)).toBe('1,5 Ko');
		expect(TEXTES.en.commun.formats.taille(1536)).toBe('1.5 KB');
	});
});
