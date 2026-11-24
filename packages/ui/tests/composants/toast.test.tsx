// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dureeAffichage, FournisseurToast, useToast } from '../../src/composants/Toast.tsx';

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

function Emetteur() {
	const toast = useToast();
	return (
		<>
			<button type="button" onClick={() => toast('Avertissement : index en retard', 'avertissement')}>
				avertir
			</button>
			<button type="button" onClick={() => toast('Avertissement : extraction incomplète', 'avertissement')}>
				avertir encore
			</button>
			<button type="button" onClick={() => toast('Fiche enregistrée')}>
				informer
			</button>
		</>
	);
}

const avertissements = () => within(screen.getByRole('list', { name: 'Avertissements' })).queryAllByRole('listitem').map((x) => x.firstChild?.textContent);

describe('toast : la durée selon le genre du message', () => {
	it('une seule fonction : information 1,9 s, avertissement jusqu’à ce qu’on le ferme', () => {
		expect(dureeAffichage('information')).toBe(1900);
		expect(dureeAffichage('avertissement')).toBeNull();
	});

	it('un avertissement suivi d’un message ordinaire : toujours affiché après 2 s ; empilés, le plus récent en haut, chacun fermable', async () => {
		vi.useFakeTimers();
		render(
			<FournisseurToast>
				<Emetteur />
			</FournisseurToast>,
		);
		fireEvent.click(screen.getByRole('button', { name: 'avertir' }));
		fireEvent.click(screen.getByRole('button', { name: 'informer' }));
		expect(screen.getByRole('status').textContent).toBe('Fiche enregistrée');
		await act(async () => vi.advanceTimersByTime(2000));
		expect(avertissements()).toEqual(['Avertissement : index en retard']);
		fireEvent.click(screen.getByRole('button', { name: 'avertir encore' }));
		expect(avertissements()).toEqual(['Avertissement : extraction incomplète', 'Avertissement : index en retard']);
		fireEvent.click(screen.getAllByRole('button', { name: 'Fermer l’avertissement' })[1]!);
		expect(avertissements()).toEqual(['Avertissement : extraction incomplète']);
	});

	it('un avertissement identique à un affiché ne s’empile pas : il remonte en haut avec un compteur', () => {
		render(
			<FournisseurToast>
				<Emetteur />
			</FournisseurToast>,
		);
		fireEvent.click(screen.getByRole('button', { name: 'avertir' }));
		fireEvent.click(screen.getByRole('button', { name: 'avertir encore' }));
		fireEvent.click(screen.getByRole('button', { name: 'avertir' }));
		fireEvent.click(screen.getByRole('button', { name: 'avertir' }));
		expect(avertissements()).toEqual(['Avertissement : index en retard', 'Avertissement : extraction incomplète']);
		expect(within(screen.getByRole('list', { name: 'Avertissements' })).getByText('×3')).toBeTruthy();
	});
});
