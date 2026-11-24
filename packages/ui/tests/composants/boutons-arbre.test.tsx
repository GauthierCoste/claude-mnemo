// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoutonsArbre } from '../../src/composants/commun/BoutonsArbre.tsx';

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('BoutonsArbre', () => {
	it.each([
		['MacIntel', '⌘', 'Meta'],
		['Win32', 'Ctrl+', 'Control'],
		['Linux x86_64', 'Ctrl+', 'Control'],
	])('raccourcis annoncés selon la plateforme (%s)', (platform, affiche, touche) => {
		vi.stubGlobal('navigator', { platform });
		render(<BoutonsArbre surReplier={() => {}} surDeplier={() => {}} />);
		const replier = screen.getByRole('button', { name: 'Tout replier' });
		const deplier = screen.getByRole('button', { name: 'Tout déplier' });
		expect(replier.title).toBe(`Tout replier (${affiche}-)`);
		expect(replier.getAttribute('aria-keyshortcuts')).toBe(`${touche}+-`);
		expect(deplier.title).toBe(`Tout déplier (${affiche}+)`);
		expect(deplier.getAttribute('aria-keyshortcuts')).toBe(`${touche}+=`);
	});
});
