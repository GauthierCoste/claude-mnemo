// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AvancementNoteVue } from '@mnemo/contrat';
import { AvancementNote } from '../../src/composants/memoire/entrainer/AvancementNote.tsx';

const EN_COURS: AvancementNoteVue = {
	part: 0.08,
	niveau: 'complets',
	parNiveau: [
		{ niveau: 'complets', part: 0.08 },
		{ niveau: 'sens', part: 0 },
	],
	volumes: [
		{ nom: 'injections', fait: 2, cible: 25 },
		{ nom: 'sessions', fait: 2, cible: 10 },
		{ nom: 'silences', fait: 16, cible: 20, sessions: { fait: 11, cible: 5 } },
	],
	qualite: null,
	ecart: { points: 3, depuis: '2026-11-26T10:00:00.000Z' },
	seuil: 0.8,
};

describe('bandeau d’avancement vers les vrais résultats', () => {
	afterEach(cleanup);

	it('pourcentage, écart, volumes en clair ; la ligne remplie jusqu’au pourcentage', () => {
		const { container } = render(<AvancementNote avancement={EN_COURS} />);
		const p = container.querySelector('p')!;
		expect(p.textContent).toContain('Vers les vrais résultats8 %+3 pts depuis le 26/11');
		expect(p.textContent).toContain('fiches injectables 2/25');
		expect(p.textContent).toContain('« Rien d’utile ici » 16/20');
		expect(p.style.getPropertyValue('--part')).toBe('8%');
	});

	it('tout élément au curseur d’aide a son infobulle', () => {
		const { container } = render(<AvancementNote avancement={EN_COURS} />);
		const aides = container.querySelectorAll('[class*="aideSurvol"]');
		expect(aides.length).toBe(5);
		for (const a of aides) expect(a.getAttribute('title')?.length ?? 0).toBeGreaterThan(10);
		expect(screen.getByText('Vers les vrais résultats').getAttribute('title')).toContain('au seuil de 80 %. Complets 8 %, Sens seul 0 %.');
	});

	it('volume atteint : le critère de qualité à la place des volumes ; sans apprentissage : « — »', () => {
		const { container, rerender } = render(<AvancementNote avancement={{ ...EN_COURS, part: 1, qualite: 'les fiches que Mnemo injecterait ne sont utiles que 72 % du temps' }} />);
		expect(container.textContent).toContain('volume atteint ; reste la qualité : les fiches que Mnemo injecterait ne sont utiles que 72 % du temps');
		expect(container.textContent).not.toContain('fiches injectables');
		expect(screen.getByRole('img', { name: 'Volume atteint' })).toBeTruthy();
		rerender(<AvancementNote avancement={{ part: null, niveau: null, parNiveau: [], volumes: [{ nom: 'silences', fait: 3, cible: 20 }], qualite: null, ecart: null, seuil: null }} />);
		expect(container.textContent).toContain('—');
		expect(container.textContent).toContain('connu au premier apprentissage');
		expect(screen.queryByRole('img', { name: 'Volume atteint' })).toBeNull();
		expect(container.textContent).toContain('« Rien d’utile ici » 3/20');
	});
});
