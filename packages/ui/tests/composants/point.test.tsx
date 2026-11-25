// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Point } from '../../src/composants/sessions/Point.tsx';

afterEach(cleanup);

describe('Point d’état (pastilles, palette, arbre)', () => {
	it('nommé par libelleEtat : l’état, ou ce qu’attend une session pas encore commencée', () => {
		render(
			<>
				<Point session={{ etat: 'attend' }} />
				<Point session={{ etat: 'attend', attentePremierMessage: 'message' }} petit />
				<Point session={{ etat: 'attend', attentePremierMessage: 'confiance' }} />
			</>,
		);
		expect(screen.getAllByRole('img').map((x) => x.getAttribute('aria-label'))).toEqual(['Attend ta réponse', 'Attend ton premier message', 'Attend ta réponse à la question de confiance']);
	});
});
