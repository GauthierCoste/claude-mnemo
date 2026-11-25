import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EtapeCalcul } from '@mnemo/commun';
import { AffichageEtape } from '../../src/sessions/etapes.ts';

describe('AffichageEtape : les étapes sans clignotement', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	const suivre = () => {
		const vues: (string | null)[] = [];
		const a = new AffichageEtape((e) => vues.push(e === null ? null : `${e.nom}${e.fait === undefined ? '' : ` ${e.fait}`}`));
		return { a, vues };
	};
	const e = (nom: EtapeCalcul['nom'], fait?: number): EtapeCalcul => (fait === undefined ? { nom } : { nom, fait, total: 30 });

	it('une étape de moins de 150 ms n’apparaît pas ; une suivante plus longue, oui', () => {
		const { a, vues } = suivre();
		a.recevoir(e('recherche'));
		vi.advanceTimersByTime(100);
		a.recevoir(e('reranker'));
		vi.advanceTimersByTime(149);
		expect(vues).toEqual([]);
		vi.advanceTimersByTime(1);
		expect(vues).toEqual(['reranker']);
	});

	it('affichée, elle reste au moins 400 ms, même si la suivante arrive aussitôt ou si le calcul finit', () => {
		const { a, vues } = suivre();
		a.recevoir(e('recherche'));
		vi.advanceTimersByTime(150);
		a.recevoir(e('note'));
		vi.advanceTimersByTime(300);
		expect(vues).toEqual(['recherche']);
		vi.advanceTimersByTime(100);
		expect(vues).toEqual(['recherche', 'note']);
		a.recevoir(null);
		vi.advanceTimersByTime(399);
		expect(vues).toEqual(['recherche', 'note']);
		vi.advanceTimersByTime(1);
		expect(vues).toEqual(['recherche', 'note', null]);
	});

	it('la progression d’une étape attendue ne repousse pas son apparition ; affichée, elle suit aussitôt', () => {
		const { a, vues } = suivre();
		a.recevoir(e('affinage', 0));
		vi.advanceTimersByTime(100);
		a.recevoir(e('affinage', 10));
		vi.advanceTimersByTime(50);
		expect(vues).toEqual(['affinage 10']);
		a.recevoir(e('affinage', 20));
		expect(vues).toEqual(['affinage 10', 'affinage 20']);
	});

	it('la fin puis une nouvelle étape avant le minimum : pas d’effacement entre les deux', () => {
		const { a, vues } = suivre();
		a.recevoir(e('note'));
		vi.advanceTimersByTime(150);
		a.recevoir(null);
		vi.advanceTimersByTime(100);
		a.recevoir(e('affinage', 0));
		vi.advanceTimersByTime(1000);
		expect(vues).toEqual(['note', 'affinage 0']);
	});
});
