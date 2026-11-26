// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ROUTES, type ReponseProfils } from '@mnemo/contrat';
import { creerClientDemo } from '../../src/client/demo.ts';
import { Application } from '../../src/composants/Application.tsx';

afterEach(cleanup);

/** Réglages › Agents de la démo ouverts (le profil `travail` dans l'éditeur). */
async function ouvrirProfils() {
	const client = creerClientDemo();
	render(<Application client={client} />);
	await act(async () => within(screen.getByRole('navigation')).getByRole('button', { name: /Réglages/ }).click());
	const liste = await screen.findByRole('navigation', { name: 'Profils' });
	await screen.findByRole('form', { name: 'Profil travail' });
	return { client, liste };
}

/** Couleur de l'avatar d'un profil dans la liste. */
const couleurDansLaListe = (liste: HTMLElement, nom: string): string =>
	(within(liste).getByRole('button', { name: new RegExp(`^${nom}`, 'u') }).querySelector('svg') as SVGElement).style.color;

describe('Réglages › Agents : nouveau profil', () => {
	it('pendant la saisie du nom, aucun éditeur : les réglages du nouveau profil (Codex, ambre) vont à lui, travail garde Claude Code et son vert', async () => {
		const { client, liste } = await ouvrirProfils();
		await act(async () => within(liste).getByRole('button', { name: 'Nouveau profil de travail' }).click());
		// l'éditeur du profil d'avant n'est plus là : rien ne peut s'y régler par erreur
		expect(screen.queryByRole('form', { name: 'Profil travail' })).toBeNull();
		expect(screen.getByText(/Nouveau profil : choisis son nom à gauche/u)).toBeTruthy();
		expect(within(liste).getByRole('button', { name: /^travail/u }).getAttribute('aria-current')).toBeNull();

		fireEvent.change(within(liste).getByLabelText('Nom du nouveau profil'), { target: { value: 'codex-essai' } });
		await act(async () => within(liste).getByRole('button', { name: 'Créer' }).click());
		const editeur = await screen.findByRole('form', { name: 'Profil codex-essai' });
		await act(async () => within(within(editeur).getByRole('radiogroup', { name: 'Moteur' })).getByRole('radio', { name: 'Codex · OpenAI' }).click());
		await act(async () => within(within(editeur).getByRole('radiogroup', { name: 'Couleur de l’avatar' })).getByRole('radio', { name: 'Ambre' }).click());
		await act(async () => within(editeur).getByRole('button', { name: 'Enregistrer' }).click());
		await within(editeur).findByText('Enregistré.');

		const { profils } = await client.api.lire<ReponseProfils>(ROUTES.profils);
		const de = (nom: string) => profils.find((x) => x.nom === nom)!;
		expect(de('travail')).toMatchObject({ moteur: 'claude-code', avatar: { forme: 'robot', couleur: 'vert' } });
		expect(de('codex-essai')).toMatchObject({ moteur: 'codex', avatar: { couleur: 'ambre' } });
		await waitFor(() => expect(couleurDansLaListe(liste, 'codex-essai')).toBe('var(--amber)'));
		expect(couleurDansLaListe(liste, 'travail')).toBe('var(--vert)');
	});

	it('modifications non enregistrées : « Nouveau profil » demande d’abord de les abandonner ; Rester garde l’éditeur et la saisie', async () => {
		const { liste } = await ouvrirProfils();
		const editeur = screen.getByRole('form', { name: 'Profil travail' });
		await act(async () => within(within(editeur).getByRole('radiogroup', { name: 'Couleur de l’avatar' })).getByRole('radio', { name: 'Rouge' }).click());
		await act(async () => within(liste).getByRole('button', { name: 'Nouveau profil de travail' }).click());
		const avis = screen.getByRole('alert');
		expect(avis.textContent).toMatch(/Modifications du profil « travail » non enregistrées/u);
		expect(within(liste).queryByLabelText('Nom du nouveau profil')).toBeNull();
		await act(async () => within(avis).getByRole('button', { name: 'Rester' }).click());
		const toujours = screen.getByRole('form', { name: 'Profil travail' });
		expect(within(within(toujours).getByRole('radiogroup', { name: 'Couleur de l’avatar' })).getByRole('radio', { name: 'Rouge' }).getAttribute('aria-checked')).toBe('true');
		// Abandonner : la saisie du nom s'ouvre, sans éditeur
		await act(async () => within(liste).getByRole('button', { name: 'Nouveau profil de travail' }).click());
		await act(async () => within(screen.getByRole('alert')).getByRole('button', { name: 'Abandonner' }).click());
		expect(within(liste).getByLabelText('Nom du nouveau profil')).toBeTruthy();
		expect(screen.queryByRole('form', { name: 'Profil travail' })).toBeNull();
	});
});
