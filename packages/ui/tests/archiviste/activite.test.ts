// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTIVITE_MAX, activiteArchiviste, ActiviteArchiviste, libelleActivite } from '../../src/composants/archiviste/ActiviteArchiviste.tsx';

const commit = (i: number) => ({ hash: `h${i}`, dateMs: i, message: `mnemo: fait x${i}.md`, fiches: [`x${i}.md`], session: null });
const vingtCinq = () => activiteArchiviste([], Array.from({ length: ACTIVITE_MAX + 5 }, (_, i) => commit(i)), []);

afterEach(cleanup);

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

	it('liste coupée à ACTIVITE_MAX : « 5 de plus » montre le reste', () => {
		render(createElement(ActiviteArchiviste, { activite: vingtCinq(), libelle: 'Activité du jour' }));
		const lignes = () => screen.getByRole('list', { name: 'Activité du jour' }).querySelectorAll('li').length;
		expect(lignes()).toBe(ACTIVITE_MAX);
		expect(screen.getByText('5 restants')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: '5 de plus' }));
		expect(lignes()).toBe(ACTIVITE_MAX + 5);
		expect(screen.queryByText(/de plus/)).toBeNull();
	});

	it('jamais tout d’un coup : une tranche de plus chaque fois que le bas de la liste devient visible', () => {
		const rappels: ((e: { isIntersecting: boolean }[]) => void)[] = [];
		vi.stubGlobal(
			'IntersectionObserver',
			class {
				constructor(f: (e: { isIntersecting: boolean }[]) => void) {
					rappels.push(f);
				}
				observe() {}
				disconnect() {}
			},
		);
		const cent = activiteArchiviste([], Array.from({ length: 100 }, (_, i) => commit(i)), []);
		render(createElement(ActiviteArchiviste, { activite: cent, libelle: 'Activité du jour' }));
		const lignes = () => screen.getByRole('list', { name: 'Activité du jour' }).querySelectorAll('li').length;
		expect(lignes()).toBe(ACTIVITE_MAX);
		act(() => rappels.at(-1)!([{ isIntersecting: true }]));
		expect(lignes()).toBe(2 * ACTIVITE_MAX);
		expect(screen.getByText(`${100 - 2 * ACTIVITE_MAX} restants`)).toBeTruthy();
		vi.unstubAllGlobals();
	});

	it('journal du jour tronqué : dit en bas, une fois tout montré, que les plus anciens manquent', () => {
		render(createElement(ActiviteArchiviste, { activite: activiteArchiviste([], [commit(1)], []), libelle: 'Activité du jour', tronque: true }));
		expect(screen.getByText('Plus de 500 changements aujourd’hui : les plus anciens ne sont pas affichés.'.replace('’', "'"))).toBeTruthy();
	});
});
