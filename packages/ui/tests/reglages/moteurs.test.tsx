// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { creerClientDemo } from '../../src/client/demo.ts';
import { Application } from '../../src/composants/Application.tsx';

afterEach(cleanup);

/** Réglages de la démo ouverts (onglet Profils d'abord). */
async function ouvrirReglages() {
	render(<Application client={creerClientDemo()} />);
	const nav = screen.getByRole('navigation');
	await act(async () => within(nav).getByRole('button', { name: /Réglages/ }).click());
	return screen.findByRole('navigation', { name: 'Profils' });
}

async function choisirProfil(nom: string): Promise<HTMLElement> {
	const liste = await ouvrirReglages();
	await act(async () => (await within(liste).findByRole('button', { name: new RegExp(`^${nom}`, 'u') })).click());
	return screen.findByRole('form', { name: `Profil ${nom}` });
}

const moteur = (editeur: HTMLElement) => within(editeur).getByRole('radiogroup', { name: 'Moteur' });
const modele = (editeur: HTMLElement) => within(editeur).getByRole('combobox', { name: 'Modèle' }) as HTMLInputElement;

describe('Réglages › Profils : moteur et modèle', () => {
	it('profil Codex : Codex coché avec sa version, son modèle, ses modèles proposés ; pas de plugins Claude Code ; aperçu avec les skills dans la consigne', async () => {
		const editeur = await choisirProfil('revue-code');
		const codex = within(moteur(editeur)).getByRole('radio', { name: /^Codex/u }) as HTMLInputElement;
		expect(codex.checked).toBe(true);
		await waitFor(() => expect(within(moteur(editeur)).getByText(/version 0\.171\.0-alpha\.13/u)).toBeTruthy());
		expect(modele(editeur).value).toBe('gpt-6.2-sol');
		const proposes = await within(editeur).findByRole('group', { name: 'Modèles proposés par Codex' });
		expect(within(proposes).getByRole('button', { name: 'gpt-6.2-sol' }).getAttribute('aria-pressed')).toBe('true');
		expect(within(editeur).queryByText('Plugins Claude Code')).toBeNull();
		expect(await within(editeur).findByText('Consigne du profil (personnalisée), avec la liste des skills')).toBeTruthy();
		expect(within(editeur).getByText('Skills de la mémoire (listées dans la consigne, lues par l’outil lire)')).toBeTruthy();
	});

	it('passer à Claude Code : modèle par défaut, alias proposés, plugins affichés ; revenir à Codex rend le modèle enregistré', async () => {
		const editeur = await choisirProfil('revue-code');
		await act(async () => within(moteur(editeur)).getByRole('radio', { name: /^Claude Code/u }).click());
		expect(modele(editeur).value).toBe('');
		expect(modele(editeur).placeholder).toBe('par défaut de Claude Code');
		const proposes = await within(editeur).findByRole('group', { name: 'Modèles proposés par Claude Code' });
		expect(within(proposes).getAllByRole('button').map((b) => b.textContent)).toEqual(['opus', 'sonnet', 'haiku']);
		await act(async () => within(proposes).getByRole('button', { name: 'opus' }).click());
		expect(modele(editeur).value).toBe('opus');
		expect(within(editeur).getByText('Plugins Claude Code')).toBeTruthy();
		await act(async () => within(moteur(editeur)).getByRole('radio', { name: /^Codex/u }).click());
		expect(modele(editeur).value).toBe('gpt-6.2-sol');
		expect((within(editeur).getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('modèle refusé : dit sous le champ ; archiviste : Codex grisé avec sa raison sur sa ligne', async () => {
		const editeur = await choisirProfil('revue-code');
		fireEvent.change(modele(editeur), { target: { value: '-x' } });
		expect(modele(editeur).getAttribute('aria-invalid')).toBe('true');
		expect(within(editeur).getByText(/^Nom refusé/u)).toBeTruthy();
		cleanup();
		const archiviste = await choisirProfil('archiviste');
		const codex = within(moteur(archiviste)).getByRole('radio', { name: /^Codex/u }) as HTMLInputElement;
		expect(codex.disabled).toBe(true);
		expect(document.getElementById(codex.getAttribute('aria-describedby')!)?.textContent).toBe('Réservé : l’archiviste reste sur Claude Code.');
	});
});

describe('Réglages › Système › Moteurs', () => {
	it('état de chaque moteur ; un point à régler avec la commande à copier', async () => {
		await ouvrirReglages();
		await act(async () => screen.getByRole('tab', { name: 'Système' }).click());
		const page = await screen.findByRole('form', { name: 'Réglages système' });
		const groupes = within(page).getByRole('navigation', { name: 'Groupes de réglages' });
		await act(async () => within(groupes).getByRole('button', { name: /^Moteurs/u }).click());
		const codex = await within(page).findByRole('group', { name: 'Codex' });
		expect(within(page).getByRole('group', { name: 'Claude Code' })).toBeTruthy();
		const point = within(codex).getByText('Approbation des hooks').closest('li')!;
		expect(point.textContent).toContain('à approuver');
		expect(within(point).getByText('À taper dans Codex :')).toBeTruthy();
		expect(within(point).getByText('/hooks').tagName).toBe('CODE');
		expect(within(point).getByRole('button', { name: 'Copier « /hooks »' })).toBeTruthy();
		expect(within(point).getByRole('img', { name: 'à régler' })).toBeTruthy();
	});
});
