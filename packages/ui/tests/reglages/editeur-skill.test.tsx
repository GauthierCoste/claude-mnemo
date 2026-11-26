// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROUTES, type ProfilDetailVue, type SkillDetailVue } from '@mnemo/contrat';
import { ErreurApi } from '../../src/client/api.ts';
import type { Client } from '../../src/client/contexte.tsx';
import { creerClientDemo } from '../../src/client/demo.ts';
import { Application } from '../../src/composants/Application.tsx';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

/** Réglages › Agents de la démo, l'agent `agent` ouvert. */
async function ouvrir(agent = 'travail', client: Client = creerClientDemo()) {
	render(<Application client={client} />);
	await act(async () => within(screen.getByRole('navigation')).getByRole('button', { name: /Réglages/ }).click());
	const liste = await screen.findByRole('navigation', { name: 'Agents' });
	await screen.findByRole('complementary', { name: 'Agent travail' });
	if (agent !== 'travail') {
		await act(async () => within(liste).getByRole('button', { name: new RegExp(`^${agent}`, 'u') }).click());
		await screen.findByRole('complementary', { name: `Agent ${agent}` });
	}
	return client;
}

const equipement = () => screen.getByRole('region', { name: 'Équipement' });
const caseInventaire = (nom: string) => within(within(equipement()).getByRole('list', { name: 'Inventaire' })).queryByRole('checkbox', { name: nom });
const pied = () => screen.getByRole('contentinfo', { name: 'Enregistrement de l’agent' });

/** Ouvre l'éditeur de la skill `nom` (crayon), ou d'une nouvelle skill ; rend la modale une fois la skill lue. */
async function editer(nom: string | null): Promise<HTMLElement> {
	if (nom === null) await act(async () => within(equipement()).getByRole('button', { name: /Nouvelle skill/u }).click());
	else await act(async () => within(equipement()).getByRole('button', { name: `Modifier la skill ${nom}` }).click());
	const modale = await screen.findByRole('dialog', { name: nom === null ? 'Nouvelle skill' : `Skill ${nom}` });
	if (nom !== null) await within(modale).findByDisplayValue(nom);
	return modale;
}
const champ = (modale: HTMLElement, nom: string) => within(modale).getByRole('textbox', { name: nom }) as HTMLInputElement;
/** Le texte relié à `el` par son `aria-describedby`. */
const description = (el: HTMLElement) =>
	(el.getAttribute('aria-describedby') ?? '')
		.split(' ')
		.map((id) => document.getElementById(id)?.textContent)
		.join(' | ');
const couleur = (nom: string) => within(screen.getByRole('radiogroup', { name: 'Couleur de l’avatar' })).getByRole('radio', { name: nom });
/** Échap sur la modale (l'événement `cancel` du navigateur). */
const echap = (modale: HTMLElement) => fireEvent(modale, new Event('cancel', { cancelable: true }));
const saisir = (modale: HTMLElement, nom: string, valeur: string) => fireEvent.change(champ(modale, nom), { target: { value: valeur } });
const lireSkill = (client: Client, nom: string, profil?: string) => client.api.lire<SkillDetailVue>(ROUTES.skill.replace(':id', nom), profil === undefined ? undefined : { profil });
const lireProfil = (client: Client, nom: string) => client.api.lire<ProfilDetailVue>(ROUTES.profil.replace(':id', nom));

describe('Éditeur de skill : modifier, renommer', () => {
	it('modifier une skill de la mémoire : icône, « Quand l’utiliser », contenu ; qui l’équipe ; écrit tout de suite', async () => {
		const client = await ouvrir();
		const modale = await editer('devis');
		expect(within(modale).getByText(/^Équipée par .*travail/u)).toBeTruthy();
		expect(champ(modale, 'Icône').value).toBe('📜');
		saisir(modale, 'Quand l’utiliser', 'Rédiger un devis client.');
		saisir(modale, 'Contenu', '# Devis\n\nTrois lots au plus.');
		await act(async () => within(modale).getByRole('button', { name: 'Enregistrer' }).click());
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		expect(await lireSkill(client, 'devis')).toMatchObject({ description: 'Rédiger un devis client.', contenu: '# Devis\n\nTrois lots au plus.' });
		// l'agent ouvert n'a rien à enregistrer
		expect(within(pied()).queryByText('Modifié, non enregistré')).toBeNull();
	});

	it('renommer une skill que l’agent équipe : son inventaire suit, sans conflit ni modification à enregistrer', async () => {
		const client = await ouvrir('redaction');
		const modale = await editer('relecture');
		saisir(modale, 'Nom', 'relecture-courrier');
		await act(async () => within(modale).getByRole('button', { name: 'Enregistrer' }).click());
		await waitFor(() => expect(caseInventaire('relecture-courrier')?.getAttribute('aria-checked')).toBe('true'));
		expect(caseInventaire('relecture')).toBeNull();
		expect((await lireProfil(client, 'redaction')).editable.skillsMemoire).toEqual(['relecture-courrier']);
		expect(within(pied()).queryByRole('alert')).toBeNull();
		expect(within(pied()).queryByText('Modifié, non enregistré')).toBeNull();
		// le focus revient sur la case de la skill renommée
		await waitFor(() => expect(document.activeElement).toBe(caseInventaire('relecture-courrier')));
	});

	it('renommer depuis un agent déjà modifié : pas de faux conflit, ses modifications restent, l’équipement suit', async () => {
		const client = await ouvrir('redaction');
		await act(async () => couleur('Rouge').click());
		const modale = await editer('relecture');
		saisir(modale, 'Nom', 'relecture-courrier');
		await act(async () => within(modale).getByRole('button', { name: 'Enregistrer' }).click());
		await waitFor(() => expect(caseInventaire('relecture-courrier')?.getAttribute('aria-checked')).toBe('true'));
		// l'agent relu, Enregistrer redevient disponible ; ni alerte, ni modification perdue
		const enregistrer = within(pied()).getByRole('button', { name: 'Enregistrer' });
		await waitFor(() => expect(enregistrer.getAttribute('aria-disabled')).toBeNull());
		expect(within(pied()).queryByRole('alert')).toBeNull();
		expect(couleur('Rouge').getAttribute('aria-checked')).toBe('true');
		expect(within(pied()).getByText('Modifié, non enregistré')).toBeTruthy();
		await act(async () => enregistrer.click());
		await within(pied()).findByText('Enregistré.');
		expect((await lireProfil(client, 'redaction')).editable).toMatchObject({ skillsMemoire: ['relecture-courrier'], avatar: { couleur: 'rouge' } });
	});

	it('refus du service (nom refusé) : le motif est dit, la modale reste ouverte', async () => {
		await ouvrir();
		const modale = await editer('devis');
		saisir(modale, 'Nom', 'Devis Client');
		await act(async () => within(modale).getByRole('button', { name: 'Enregistrer' }).click());
		expect((await within(modale).findByRole('alert')).textContent).toMatch(/nom refusé/u);
		expect(screen.getByRole('dialog')).toBeTruthy();
	});

	it('skill changée ailleurs (409) : message neutre et « Recharger », qui reprend la version enregistrée', async () => {
		const client = creerClientDemo();
		const remplacer = client.api.remplacer.bind(client.api);
		vi.spyOn(client.api, 'remplacer').mockImplementation(async (chemin, corps) => {
			if (chemin.startsWith('/api/skills/')) throw new ErreurApi('Le SKILL.md de la skill a changé depuis son ouverture : à recharger.', 409);
			return remplacer(chemin, corps);
		});
		await ouvrir('travail', client);
		const modale = await editer('devis');
		saisir(modale, 'Contenu', 'Autre chose.');
		await act(async () => within(modale).getByRole('button', { name: 'Enregistrer' }).click());
		const alerte = within(modale).getByRole('alert');
		expect(alerte.textContent).toMatch(/^Cette skill a été modifiée ailleurs depuis son ouverture/u);
		const bouton = within(modale).getByRole('button', { name: 'Enregistrer' });
		expect(bouton.getAttribute('aria-disabled')).toBe('true');
		expect(description(bouton)).toBe('À recharger : la skill a changé ailleurs.');
		await act(async () => within(alerte).getByRole('button', { name: 'Recharger' }).click());
		await waitFor(() => expect(within(modale).queryByRole('alert')).toBeNull());
		expect(champ(modale, 'Contenu').value).toMatch(/^# Devis/u);
	});
});

describe('Éditeur de skill : créer', () => {
	it('dans la mémoire (le choix par défaut) : créée tout de suite, équipée sur l’agent dans son brouillon, à enregistrer', async () => {
		const client = await ouvrir('redaction');
		const modale = await editer(null);
		expect((within(modale).getByRole('radio', { name: /^Dans la mémoire/u }) as HTMLInputElement).checked).toBe(true);
		expect(within(modale).getByText(/équipée sur « redaction » : enregistre l’agent pour garder cet équipement/u)).toBeTruthy();
		// nom et « Quand l'utiliser » obligatoires : Créer grisé, avec la raison
		const creer = within(modale).getByRole('button', { name: 'Créer' });
		expect(creer.getAttribute('aria-disabled')).toBe('true');
		expect(description(creer)).toBe('Le nom et « Quand l’utiliser » sont obligatoires.');
		// chaque champ porte son nom exact, son aide en description
		expect(description(champ(modale, 'Nom'))).toBe('minuscules, chiffres et tirets ; c’est le nom que voit l’agent');
		expect(description(champ(modale, 'Quand l’utiliser'))).toBe('l’agent charge la skill quand sa tâche correspond à cette phrase');
		saisir(modale, 'Nom', 'compte-rendu');
		saisir(modale, 'Quand l’utiliser', 'Rédiger le compte rendu d’une réunion.');
		saisir(modale, 'Contenu', 'Décisions, actions, points ouverts.');
		expect(creer.getAttribute('aria-disabled')).toBeNull();
		await act(async () => creer.click());
		await waitFor(() => expect(caseInventaire('compte-rendu')?.getAttribute('aria-checked')).toBe('true'));
		expect(await lireSkill(client, 'compte-rendu')).toMatchObject({ profil: null, icone: '✨', description: 'Rédiger le compte rendu d’une réunion.' });
		expect(within(pied()).getByText('Modifié, non enregistré')).toBeTruthy();
		await act(async () => within(pied()).getByRole('button', { name: 'Enregistrer' }).click());
		await within(pied()).findByText('Enregistré.');
		expect((await lireProfil(client, 'redaction')).editable.skillsMemoire).toEqual(['relecture', 'compte-rendu']);
	});

	it('pour cet agent seulement : une skill de l’agent, toujours équipée, rien à enregistrer', async () => {
		const client = await ouvrir('redaction');
		const modale = await editer(null);
		await act(async () => within(modale).getByRole('radio', { name: /^Pour redaction seulement/u }).click());
		saisir(modale, 'Nom', 'formules');
		saisir(modale, 'Quand l’utiliser', 'Choisir la formule de politesse.');
		await act(async () => within(modale).getByRole('button', { name: 'Créer' }).click());
		await waitFor(() => expect(caseInventaire('formules')?.getAttribute('aria-disabled')).toBe('true'));
		expect(await lireSkill(client, 'formules', 'redaction')).toMatchObject({ profil: 'redaction' });
		expect(within(pied()).queryByText('Modifié, non enregistré')).toBeNull();
	});
});

describe('Éditeur de skill : supprimer, revenir à l’origine, skill fournie', () => {
	it('supprimer : le second clic confirme et dit combien d’agents la perdent ; un autre geste annule la confirmation', async () => {
		const client = await ouvrir();
		const modale = await editer('devis');
		const supprimer = () => within(modale).getByRole('button', { name: /^(Supprimer|Retirer aussi|Confirmer)/u });
		await act(async () => supprimer().click());
		expect(supprimer().textContent).toBe('Retirer aussi de 3 agents ?');
		saisir(modale, 'Contenu', 'x');
		expect(supprimer().textContent).toBe('Supprimer');
		await act(async () => supprimer().click());
		await act(async () => supprimer().click());
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		await waitFor(() => expect(caseInventaire('devis')).toBeNull());
		// la skill n'existe plus : le focus va sur l'inventaire
		expect(document.activeElement?.getAttribute('aria-label')).toBe('Inventaire');
		await expect(lireSkill(client, 'devis')).rejects.toMatchObject({ statut: 404 });
	});

	it('skill fournie par Mnemo : avis, ni renommée ni supprimée (la raison sur l’action grisée) ; modifiée, elle revient à l’origine', async () => {
		const client = await ouvrir('archiviste');
		let modale = await editer('menage');
		expect(within(modale).getByText(/^Skill fournie par Mnemo : la modifier arrête ses mises à jour automatiques/u)).toBeTruthy();
		expect(within(modale).queryByRole('button', { name: 'Revenir à la version d’origine' })).toBeNull();
		expect(champ(modale, 'Nom').readOnly).toBe(true);
		const supprimer = within(modale).getByRole('button', { name: 'Supprimer' });
		expect(supprimer.getAttribute('aria-disabled')).toBe('true');
		expect(document.getElementById(supprimer.getAttribute('aria-describedby')!)?.textContent).toMatch(/^Skill « menage » fournie par Mnemo : elle se modifie ou revient à sa version d'origine, mais ne se renomme ni ne se supprime/u);
		await act(async () => supprimer.click());
		expect(supprimer.textContent).toBe('Supprimer');

		saisir(modale, 'Contenu', 'Ma façon de faire le ménage.');
		await act(async () => within(modale).getByRole('button', { name: 'Enregistrer' }).click());
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		modale = await editer('menage');
		expect(within(modale).getByText(/modifiée : elle ne suit plus ses mises à jour automatiques/u)).toBeTruthy();
		await act(async () => within(modale).getByRole('button', { name: 'Revenir à la version d’origine' }).click());
		await waitFor(() => expect(champ(modale, 'Contenu').value).toMatch(/^1\. Commence par `diagnostiquer`/u));
		expect(await lireSkill(client, 'menage', 'archiviste')).toMatchObject({ modifiee: false });
	});

	it('Annuler ou Échap : sans saisie, ferme ; avec une saisie, demande d’abord de l’abandonner ; rien n’est écrit', async () => {
		const client = await ouvrir();
		const remplacer = vi.spyOn(client.api, 'remplacer');
		const envoyer = vi.spyOn(client.api, 'envoyer');
		let modale = await editer('devis');
		await act(async () => within(modale).getByRole('button', { name: 'Annuler' }).click());
		expect(screen.queryByRole('dialog')).toBeNull();

		modale = await editer('devis');
		saisir(modale, 'Contenu', 'brouillon');
		await act(async () => within(modale).getByRole('button', { name: 'Annuler' }).click());
		const avis = within(modale).getByRole('alert');
		expect(avis.textContent).toMatch(/^Abandonner la saisie \?/u);
		await act(async () => within(avis).getByRole('button', { name: 'Continuer' }).click());
		expect(champ(modale, 'Contenu').value).toBe('brouillon');
		await act(async () => echap(modale));
		await act(async () => within(within(modale).getByRole('alert')).getByRole('button', { name: 'Abandonner' }).click());
		expect(screen.queryByRole('dialog')).toBeNull();

		// une nouvelle skill entamée : même question
		modale = await editer(null);
		saisir(modale, 'Nom', 'essai');
		await act(async () => echap(modale));
		expect(within(modale).getByRole('alert').textContent).toMatch(/^Abandonner la saisie \?/u);
		expect(remplacer).not.toHaveBeenCalled();
		expect(envoyer).not.toHaveBeenCalled();
		expect((await lireSkill(client, 'devis')).contenu).toMatch(/^# Devis/u);
	});

	it('Échap pendant une écriture : ignoré, la modale reste', async () => {
		const client = await ouvrir();
		let fin = () => {};
		const remplacer = client.api.remplacer.bind(client.api);
		vi.spyOn(client.api, 'remplacer').mockImplementation(async (chemin, corps) => {
			await new Promise<void>((r) => (fin = r));
			return remplacer(chemin, corps);
		});
		const modale = await editer('devis');
		saisir(modale, 'Contenu', 'Autre chose.');
		await act(async () => within(modale).getByRole('button', { name: 'Enregistrer' }).click());
		await act(async () => echap(modale));
		expect(screen.getByRole('dialog')).toBeTruthy();
		expect(within(modale).queryByRole('alert')).toBeNull();
		await act(async () => fin());
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
	});
});
