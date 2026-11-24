// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { ACTIVITE_MAX, activiteArchiviste, ActiviteArchiviste, libelleActivite } from '../../src/composants/archiviste/ActiviteArchiviste.tsx';

const commit = (i: number) => ({ hash: `h${i}`, dateMs: i, message: `mnemo: fait x${i}.md`, fiches: [`x${i}.md`], session: null });
const vingtCinq = () => activiteArchiviste([], Array.from({ length: ACTIVITE_MAX + 5 }, (_, i) => commit(i)), []);

describe('activiteArchiviste', () => {
	it('toutes les lignes, plus récentes d’abord', () => {
		const r = vingtCinq();
		expect(r.lignes).toHaveLength(ACTIVITE_MAX + 5);
		expect(r.lignes[0]!.cle).toBe(`commit|h${ACTIVITE_MAX + 4}`);
	});

	it('libellé : « Activité (N) », N compté avant toute coupure', () => {
		expect(libelleActivite({ lignes: [] })).toBe('Activité (0)');
		expect(libelleActivite(vingtCinq())).toBe(`Activité (${ACTIVITE_MAX + 5})`);
	});

	it('liste coupée à ACTIVITE_MAX : « 5 de plus » et « Tout voir » (DePlus) ouvrent le reste', () => {
		render(createElement(ActiviteArchiviste, { activite: vingtCinq(), libelle: 'Activité du jour' }));
		const lignes = () => screen.getByRole('list', { name: 'Activité du jour' }).querySelectorAll('li').length;
		expect(lignes()).toBe(ACTIVITE_MAX);
		expect(screen.getByText('5 de plus')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Tout voir' }));
		expect(lignes()).toBe(ACTIVITE_MAX + 5);
		expect(screen.queryByText(/de plus/)).toBeNull();
	});
});
