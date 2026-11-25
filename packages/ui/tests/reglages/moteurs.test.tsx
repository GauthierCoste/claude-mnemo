// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROUTES, type ReponseMoteurs } from '@mnemo/contrat';
import type { Client } from '../../src/client/contexte.tsx';
import { creerClientDemo } from '../../src/client/demo.ts';
import { Application } from '../../src/composants/Application.tsx';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

/** Réglages de la démo ouverts (onglet Profils d'abord). */
async function ouvrirReglages(client: Client = creerClientDemo()) {
	render(<Application client={client} />);
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

	it('chaque choix : son nom seul comme libellé, sa ligne d’état et d’effet comme description (lue une fois)', async () => {
		const editeur = await choisirProfil('revue-code');
		const codex = within(moteur(editeur)).getByRole('radio', { name: 'Codex' });
		// la description se complète quand les moteurs sont chargés (version) : attendue, sans course
		const description = () => document.getElementById(codex.getAttribute('aria-describedby')!)!;
		await waitFor(() => expect(description().textContent).toMatch(/^version 0\.171\.0-alpha\.13 — skills listées/u));
		expect(description().closest('label')).toBeNull();
	});

	it('aller-retour de moteur : le modèle saisi pour chacun est gardé pendant l’édition', async () => {
		const editeur = await choisirProfil('revue-code');
		fireEvent.change(modele(editeur), { target: { value: 'gpt-6.2-astra' } });
		await act(async () => within(moteur(editeur)).getByRole('radio', { name: 'Claude Code' }).click());
		fireEvent.change(modele(editeur), { target: { value: 'sonnet' } });
		await act(async () => within(moteur(editeur)).getByRole('radio', { name: 'Codex' }).click());
		expect(modele(editeur).value).toBe('gpt-6.2-astra');
		await act(async () => within(moteur(editeur)).getByRole('radio', { name: 'Claude Code' }).click());
		expect(modele(editeur).value).toBe('sonnet');
	});

	it('modèle refusé : Enregistrer indisponible avec la raison, rien n’est envoyé', async () => {
		const client = creerClientDemo();
		const remplacer = vi.spyOn(client.api, 'remplacer');
		const liste = await ouvrirReglages(client);
		await act(async () => (await within(liste).findByRole('button', { name: /^revue-code/u })).click());
		const editeur = await screen.findByRole('form', { name: 'Profil revue-code' });
		fireEvent.change(modele(editeur), { target: { value: '-x' } });
		const enregistrer = within(editeur).getByRole('button', { name: 'Enregistrer' });
		expect(enregistrer.getAttribute('aria-disabled')).toBe('true');
		expect(document.getElementById(enregistrer.getAttribute('aria-describedby')!)?.textContent).toMatch(/^Enregistrement impossible : le nom du modèle est refusé/u);
		await act(async () => enregistrer.click());
		expect(remplacer).not.toHaveBeenCalled();
		fireEvent.change(modele(editeur), { target: { value: 'gpt-6.2-astra' } });
		expect(within(editeur).getByRole('button', { name: 'Enregistrer' }).getAttribute('aria-disabled')).toBeNull();
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
		// groupe en lecture seule : pas de pied Enregistrer / Annuler
		expect(within(page).queryByRole('button', { name: 'Enregistrer' })).toBeNull();
		expect(within(page).queryByRole('button', { name: 'Annuler les modifications' })).toBeNull();
	});

	it('« Relire » : désactivé, section occupée et « Vérification… » pendant chaque lecture ; redémarrage proposé en deux commandes', async () => {
		const client = creerClientDemo();
		const lire = client.api.lire.bind(client.api);
		let liberer: () => void = () => {};
		let lectures = 0;
		vi.spyOn(client.api, 'lire').mockImplementation(async (chemin, params, options) => {
			if (chemin !== ROUTES.moteurs || params?.['poste'] !== '1') return lire(chemin, params, options);
			const r = await lire<ReponseMoteurs>(chemin, params, options);
			// compté une fois la lecture suspendue : `liberer` la fait aboutir
			await new Promise<void>((f) => {
				liberer = f;
				lectures++;
			});
			const codex = r.moteurs.find((m) => m.id === 'codex')!;
			codex.poste![0] = { cle: 'commande', libelle: 'Commande', ok: false, etat: 'changée', detail: 'autre chemin', remede: { texte: 'mnemo arreter', dans: 'terminal', puis: 'mnemo ouvrir' } };
			return r as never;
		});
		await ouvrirReglages(client);
		await act(async () => screen.getByRole('tab', { name: 'Système' }).click());
		const page = await screen.findByRole('form', { name: 'Réglages système' });
		await act(async () => within(within(page).getByRole('navigation', { name: 'Groupes de réglages' })).getByRole('button', { name: /^Moteurs/u }).click());
		const section = within(page).getByRole('region', { name: 'Moteurs' });
		const relire = within(section).getByRole('button', { name: 'Relire' }) as HTMLButtonElement;
		await waitFor(() => expect(lectures).toBe(1));
		expect(relire.disabled).toBe(true);
		expect(section.getAttribute('aria-busy')).toBe('true');
		expect(within(section).getByRole('status').textContent).toBe('Vérification des moteurs… (quelques secondes)');
		await act(async () => liberer());
		await waitFor(() => expect(relire.disabled).toBe(false));
		const point = within(within(section).getByRole('group', { name: 'Codex' })).getByText('Commande', { selector: 'span' }).closest('li')!;
		expect(within(point).getByRole('button', { name: 'Copier « mnemo arreter »' })).toBeTruthy();
		expect(within(point).getByText('puis')).toBeTruthy();
		expect(within(point).getByRole('button', { name: 'Copier « mnemo ouvrir »' })).toBeTruthy();
		await act(async () => relire.click());
		await waitFor(() => expect(lectures).toBe(2));
		expect(relire.disabled).toBe(true);
		expect(section.getAttribute('aria-busy')).toBe('true');
		expect(within(section).getByRole('status').textContent).toBe('Vérification…');
		await act(async () => liberer());
		await waitFor(() => expect(relire.disabled).toBe(false));
	});
});
