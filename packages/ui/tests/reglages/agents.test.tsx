// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROUTES, type ProfilDetailVue, type ReponseProfils } from '@mnemo/contrat';
import { ErreurApi } from '../../src/client/api.ts';
import type { Client } from '../../src/client/contexte.tsx';
import { creerClientDemo } from '../../src/client/demo.ts';
import { Application } from '../../src/composants/Application.tsx';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

/** Réglages › Agents de la démo ouverts, l'agent `travail` dans le créateur. */
async function ouvrirAgents(client: Client = creerClientDemo()) {
	render(<Application client={client} />);
	const rail = screen.getByRole('navigation');
	await act(async () => within(rail).getByRole('button', { name: /Réglages/ }).click());
	const liste = await screen.findByRole('navigation', { name: 'Agents' });
	await screen.findByRole('complementary', { name: 'Agent travail' });
	return { client, liste, rail };
}

/** Choisit un agent dans la liste ; rend sa scène une fois chargée. */
async function choisir(liste: HTMLElement, nom: string): Promise<HTMLElement> {
	await act(async () => within(liste).getByRole('button', { name: new RegExp(`^${nom}`, 'u') }).click());
	return screen.findByRole('complementary', { name: `Agent ${nom}` });
}

const bloc = (nom: string) => screen.getByRole('region', { name: nom });
const classe = (nom: RegExp) => within(within(bloc('Classe')).getByRole('radiogroup', { name: 'Classe' })).getByRole('radio', { name: nom });
const caseInventaire = (nom: string) => within(within(bloc('Équipement')).getByRole('list', { name: 'Inventaire' })).getByRole('checkbox', { name: nom });
const pouvoir = (nom: string) => within(bloc('Pouvoirs')).getByRole('switch', { name: nom });
const pied = () => screen.getByRole('contentinfo', { name: 'Enregistrement de l’agent' });
const enregistrer = () => within(pied()).getByRole('button', { name: 'Enregistrer' });
const description = (el: HTMLElement) =>
	(el.getAttribute('aria-describedby') ?? '')
		.split(' ')
		.map((id) => document.getElementById(id)?.textContent)
		.join(' | ');
const detail = (client: Client, nom: string) => client.api.lire<ProfilDetailVue>(ROUTES.profil.replace(':id', nom));

describe('Réglages › Agents : la scène', () => {
	it('nom, rôle, classe, stats et départ ; l’interrupteur change la phrase et marque l’agent modifié', async () => {
		await ouvrirAgents();
		const scene = screen.getByRole('complementary', { name: 'Agent travail' });
		expect(within(scene).getByRole('heading', { name: 'travail' })).toBeTruthy();
		expect(within(scene).getByText('Agent par défaut.')).toBeTruthy();
		expect(within(scene).getByText('Anthropic')).toBeTruthy();
		expect(within(scene).getByText('modèle par défaut')).toBeTruthy();
		const stats = within(within(scene).getByRole('list', { name: 'Stats' })).getAllByRole('listitem');
		expect(stats.map((x) => x.textContent)).toEqual(['Skills2', 'Plugins0', 'Pouvoirs6']);
		// pas de part de contexte : l'aperçu n'en donne aucune estimation
		expect(within(scene).queryByText('Contexte')).toBeNull();

		const depart = within(scene).getByRole('switch', { name: 'Démarre dans la mémoire' });
		expect(depart.getAttribute('aria-checked')).toBe('false');
		expect(description(depart)).toMatch(/dossier que tu choisis au lancement/u);
		expect(within(pied()).queryByText('Modifié, non enregistré')).toBeNull();
		await act(async () => depart.click());
		expect(depart.getAttribute('aria-checked')).toBe('true');
		expect(description(depart)).toMatch(/dossier de la mémoire \(_mnemo\)/u);
		expect(within(pied()).getByText('Modifié, non enregistré')).toBeTruthy();
		// Annuler : la saisie repart de ce qui est enregistré
		await act(async () => within(pied()).getByRole('button', { name: 'Annuler' }).click());
		expect(depart.getAttribute('aria-checked')).toBe('false');
	});

	it('archiviste : départ fixé, dit pourquoi ; un agent Codex n’a pas de stat Plugins', async () => {
		const { liste } = await ouvrirAgents();
		const archiviste = await choisir(liste, 'archiviste');
		const depart = within(archiviste).getByRole('switch', { name: 'Démarre dans la mémoire' });
		expect(depart.getAttribute('aria-disabled')).toBe('true');
		expect(description(depart)).toMatch(/L’archiviste démarre toujours dans la mémoire/u);
		await act(async () => depart.click());
		expect(depart.getAttribute('aria-checked')).toBe('true');
		const codex = await choisir(liste, 'revue-code');
		expect(within(within(codex).getByRole('list', { name: 'Stats' })).getAllByRole('listitem').map((x) => x.firstChild?.textContent)).toEqual(['Skills', 'Pouvoirs']);
	});
});

describe('Réglages › Agents : la classe', () => {
	it('moteur non lié verrouillé 🔒 avec la raison sur sa carte ; Codex se choisit, ses modèles en puces, « par défaut » d’abord', async () => {
		await ouvrirAgents();
		const vibe = classe(/^Mistral Vibe/u);
		await waitFor(() => expect(vibe.getAttribute('aria-disabled')).toBe('true'));
		expect(description(vibe)).toBe('À lier : lie Mistral Vibe à Mnemo dans Réglages › Branchements.');
		await act(async () => vibe.click());
		expect(vibe.getAttribute('aria-checked')).toBe('false');

		await act(async () => classe(/^Codex/u).click());
		expect(classe(/^Codex/u).getAttribute('aria-checked')).toBe('true');
		const puces = await within(bloc('Classe')).findByRole('group', { name: 'Modèles de Codex' });
		await waitFor(() => expect(within(puces).getAllByRole('button').map((b) => b.textContent)).toEqual(['par défaut', 'gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-6.1-terra']));
		expect(within(puces).getByRole('button', { name: 'par défaut' }).getAttribute('aria-pressed')).toBe('true');
		await act(async () => within(puces).getByRole('button', { name: 'gpt-6.2-astra' }).click());
		expect(within(bloc('Classe')).getByText(/^Skills listées dans la consigne/u)).toBeTruthy();
		expect(within(screen.getByRole('complementary', { name: 'Agent travail' })).getByText('gpt-6.2-astra')).toBeTruthy();
	});

	it('le moteur déjà choisi n’est pas verrouillé, même non lié ; l’archiviste reste sur Claude Code', async () => {
		const { liste } = await ouvrirAgents();
		await choisir(liste, 'veille-technique');
		await waitFor(() => expect(classe(/^Codex/u).getAttribute('aria-disabled')).toBeNull());
		expect(classe(/^Mistral Vibe/u).getAttribute('aria-checked')).toBe('true');
		expect(classe(/^Mistral Vibe/u).getAttribute('aria-disabled')).toBeNull();
		await choisir(liste, 'archiviste');
		for (const nom of [/^Codex/u, /^Mistral Vibe/u]) {
			expect(classe(nom).getAttribute('aria-disabled')).toBe('true');
			expect(description(classe(nom))).toBe('Réservé : l’archiviste reste sur Claude Code.');
		}
	});

	it('aller-retour de moteur : le modèle saisi pour chacun est gardé ; un modèle refusé rend Enregistrer indisponible, avec la raison', async () => {
		const client = creerClientDemo();
		const remplacer = vi.spyOn(client.api, 'remplacer');
		const { liste } = await ouvrirAgents(client);
		await choisir(liste, 'revue-code');
		const modele = () => within(bloc('Classe')).getByRole('combobox', { name: 'Modèle' }) as HTMLInputElement;
		await waitFor(() => expect(within(bloc('Classe')).getByRole('button', { name: 'gpt-6.2-sol' }).getAttribute('aria-pressed')).toBe('true'));
		fireEvent.change(modele(), { target: { value: 'gpt-maison' } });
		await act(async () => classe(/^Claude Code/u).click());
		expect(within(bloc('Classe')).getByRole('button', { name: 'par défaut' }).getAttribute('aria-pressed')).toBe('true');
		await act(async () => classe(/^Codex/u).click());
		expect(modele().value).toBe('gpt-maison');

		fireEvent.change(modele(), { target: { value: '-x' } });
		expect(modele().getAttribute('aria-invalid')).toBe('true');
		expect(within(bloc('Classe')).getByText(/^Nom refusé/u)).toBeTruthy();
		expect(enregistrer().getAttribute('aria-disabled')).toBe('true');
		expect(description(enregistrer())).toMatch(/^Enregistrement impossible : le nom du modèle est refusé/u);
		await act(async () => enregistrer().click());
		expect(remplacer).not.toHaveBeenCalled();
	});
});

describe('Réglages › Agents : l’équipement', () => {
	it('toutes les skills de la mémoire : décocher une skill garde les autres, l’enregistrement l’envoie', async () => {
		const { client } = await ouvrirAgents();
		expect(within(bloc('Équipement')).getByRole('switch', { name: /Toutes les skills de la mémoire/u }).getAttribute('aria-checked')).toBe('true');
		expect(caseInventaire('devis').getAttribute('aria-checked')).toBe('true');
		await act(async () => caseInventaire('devis').click());
		expect(caseInventaire('devis').getAttribute('aria-checked')).toBe('false');
		expect(caseInventaire('relecture').getAttribute('aria-checked')).toBe('true');
		expect(within(bloc('Équipement')).getByRole('switch', { name: /Toutes les skills de la mémoire/u }).getAttribute('aria-checked')).toBe('false');
		expect(within(bloc('Équipement')).getByText(/· 1 équipé$/u)).toBeTruthy();
		await act(async () => enregistrer().click());
		await within(pied()).findByText('Enregistré.');
		expect((await detail(client, 'travail')).editable.skillsMemoire).toEqual(['relecture']);
	});

	it('skills de l’agent toujours équipées ; plugins de Claude Code, grisés avec la raison sous un autre moteur ; crayon sauf sur un plugin', async () => {
		const { liste } = await ouvrirAgents();
		await choisir(liste, 'redaction');
		const signature = caseInventaire('signature');
		expect(signature.getAttribute('aria-checked')).toBe('true');
		expect(signature.getAttribute('aria-disabled')).toBe('true');
		expect(description(signature)).toBe('Les skills de l’agent sont toujours équipées.');
		expect(caseInventaire('superpowers').getAttribute('aria-checked')).toBe('true');
		// un plugin retenu mais plus installé : à décocher pour le retirer
		expect(caseInventaire('ancien@marketplace').getAttribute('aria-checked')).toBe('true');
		const inventaire = within(bloc('Équipement'));
		expect(inventaire.getByRole('button', { name: 'Modifier la skill signature' })).toBeTruthy();
		expect(inventaire.getByRole('button', { name: 'Modifier la skill relecture' })).toBeTruthy();
		expect(inventaire.queryByRole('button', { name: 'Modifier la skill superpowers' })).toBeNull();

		await act(async () => classe(/^Codex/u).click());
		const plugin = caseInventaire('superpowers');
		expect(plugin.getAttribute('aria-disabled')).toBe('true');
		expect(plugin.getAttribute('aria-checked')).toBe('false');
		expect(description(plugin)).toBe('Les plugins sont propres à Claude Code.');
		expect(inventaire.queryByRole('checkbox', { name: 'ancien@marketplace' })).toBeNull();
		// retour à Claude Code : les plugins saisis reviennent
		await act(async () => classe(/^Claude Code/u).click());
		expect(caseInventaire('superpowers').getAttribute('aria-checked')).toBe('true');
	});
});

describe('Réglages › Agents : pouvoirs et mission', () => {
	it('au moins un pouvoir : le dernier allumé ne s’éteint pas, et le dit', async () => {
		const { liste } = await ouvrirAgents();
		await choisir(liste, 'archiviste');
		expect(['Éveil', 'Veille', 'Récit'].map((x) => pouvoir(x).getAttribute('aria-checked'))).toEqual(['true', 'true', 'true']);
		expect(description(pouvoir('Éveil'))).toBe('au démarrage : la session apparaît dans Sessions');
		await act(async () => pouvoir('Éveil').click());
		await act(async () => pouvoir('Veille').click());
		const recit = pouvoir('Récit');
		expect(recit.getAttribute('aria-disabled')).toBe('true');
		expect(description(recit)).toMatch(/Au moins un pouvoir reste allumé\.$/u);
		await act(async () => recit.click());
		expect(recit.getAttribute('aria-checked')).toBe('true');
		await act(async () => pouvoir('Souffle').click());
		expect(pouvoir('Récit').getAttribute('aria-disabled')).toBeNull();
	});

	it('mission : la consigne par défaut se modifie, puis revient d’un geste', async () => {
		await ouvrirAgents();
		const consigne = within(bloc('Mission')).getByRole('textbox', { name: 'Consigne de l’agent' }) as HTMLTextAreaElement;
		expect(consigne.value).toMatch(/^La mémoire Mnemo de ce dossier/u);
		expect(within(bloc('Mission')).getByText(/^Consigne par défaut/u)).toBeTruthy();
		fireEvent.change(consigne, { target: { value: 'Ma consigne.' } });
		expect(within(pied()).getByText('Modifié, non enregistré')).toBeTruthy();
		await act(async () => within(bloc('Mission')).getByRole('button', { name: 'Revenir à la consigne par défaut' }).click());
		expect(consigne.value).toMatch(/^La mémoire Mnemo de ce dossier/u);
		expect(within(pied()).queryByText('Modifié, non enregistré')).toBeNull();
	});
});

describe('Réglages › Agents : modifications non enregistrées', () => {
	it('changer d’agent est retenu dans la page : Rester garde la saisie, Abandonner ouvre l’autre agent', async () => {
		const { liste } = await ouvrirAgents();
		await act(async () => within(within(bloc('Apparence')).getByRole('radiogroup', { name: 'Couleur de l’avatar' })).getByRole('radio', { name: 'Rouge' }).click());
		await act(async () => within(liste).getByRole('button', { name: /^redaction/u }).click());
		const avis = screen.getByRole('alert');
		expect(avis.textContent).toMatch(/Modifications de l’agent « travail » non enregistrées/u);
		await act(async () => within(avis).getByRole('button', { name: 'Rester' }).click());
		expect(within(within(bloc('Apparence')).getByRole('radiogroup', { name: 'Couleur de l’avatar' })).getByRole('radio', { name: 'Rouge' }).getAttribute('aria-checked')).toBe('true');
		await act(async () => within(liste).getByRole('button', { name: /^redaction/u }).click());
		await act(async () => within(screen.getByRole('alert')).getByRole('button', { name: 'Abandonner' }).click());
		expect(await screen.findByRole('complementary', { name: 'Agent redaction' })).toBeTruthy();
	});

	it('quitter les Réglages : la sortie est retenue ; Enregistrer enregistre puis part', async () => {
		const { client, rail } = await ouvrirAgents();
		const sessions = () => within(rail).getByRole('button', { name: /Sessions/ });
		await act(async () => within(within(bloc('Apparence')).getByRole('radiogroup', { name: 'Forme de l’avatar' })).getByRole('radio', { name: 'Chat' }).click());
		await act(async () => sessions().click());
		const alerte = within(pied()).getByRole('alert');
		expect(alerte.textContent).toMatch(/les enregistrer avant de quitter les Réglages/u);
		await act(async () => within(alerte).getByRole('button', { name: 'Rester' }).click());
		expect(within(pied()).queryByRole('alert')).toBeNull();
		await act(async () => sessions().click());
		await act(async () => within(within(pied()).getByRole('alert')).getByRole('button', { name: 'Enregistrer' }).click());
		await waitFor(() => expect(sessions().getAttribute('aria-current')).toBe('page'));
		expect((await detail(client, 'travail')).editable.avatar.forme).toBe('chat');
	});

	it('fiche changée ailleurs (409) : message neutre et « Recharger », qui reprend la version enregistrée', async () => {
		const client = creerClientDemo();
		const remplacer = client.api.remplacer.bind(client.api);
		vi.spyOn(client.api, 'remplacer').mockImplementation(async (chemin, corps) => {
			if (chemin === ROUTES.profil.replace(':id', 'travail')) throw new ErreurApi('La fiche du profil a changé.', 409);
			return remplacer(chemin, corps);
		});
		await ouvrirAgents(client);
		await act(async () => within(within(bloc('Apparence')).getByRole('radiogroup', { name: 'Couleur de l’avatar' })).getByRole('radio', { name: 'Rouge' }).click());
		await act(async () => enregistrer().click());
		const alerte = within(pied()).getByRole('alert');
		expect(alerte.textContent).toMatch(/^Cet agent a été modifié ailleurs depuis son ouverture/u);
		expect(enregistrer().getAttribute('aria-disabled')).toBe('true');
		await act(async () => within(alerte).getByRole('button', { name: 'Recharger' }).click());
		expect(within(pied()).queryByRole('alert')).toBeNull();
		expect(within(within(bloc('Apparence')).getByRole('radiogroup', { name: 'Couleur de l’avatar' })).getByRole('radio', { name: 'Vert' }).getAttribute('aria-checked')).toBe('true');
	});
});

describe('Réglages › Agents : créer, dupliquer, supprimer un agent', () => {
	it('nouvel agent : pendant la saisie du nom, aucun créateur ; créé, ses réglages vont à lui', async () => {
		const { client, liste } = await ouvrirAgents();
		await act(async () => within(liste).getByRole('button', { name: '+ Nouvel agent' }).click());
		expect(screen.queryByRole('complementary', { name: 'Agent travail' })).toBeNull();
		expect(screen.getByText(/Nouvel agent : choisis son nom à gauche/u)).toBeTruthy();
		fireEvent.change(within(liste).getByLabelText('Nom du nouvel agent'), { target: { value: 'codex-essai' } });
		await act(async () => within(liste).getByRole('button', { name: 'Créer' }).click());
		await screen.findByRole('complementary', { name: 'Agent codex-essai' });
		await act(async () => classe(/^Codex/u).click());
		await act(async () => within(within(bloc('Apparence')).getByRole('radiogroup', { name: 'Couleur de l’avatar' })).getByRole('radio', { name: 'Ambre' }).click());
		await act(async () => enregistrer().click());
		await within(pied()).findByText('Enregistré.');
		const { profils } = await client.api.lire<ReponseProfils>(ROUTES.profils);
		expect(profils.find((x) => x.nom === 'codex-essai')).toMatchObject({ moteur: 'codex', avatar: { couleur: 'ambre' } });
		expect(profils.find((x) => x.nom === 'travail')).toMatchObject({ moteur: 'claude-code', avatar: { couleur: 'vert' } });
		await waitFor(() => expect(within(liste).getByRole('button', { name: /^codex-essai/u }).textContent).toMatch(/Codex · par défaut$/u));
	});

	it('Gérer l’agent : dupliquer ouvre la copie ; supprimer demande confirmation ; un agent fourni ne se supprime pas, et le dit', async () => {
		const { liste } = await ouvrirAgents();
		const gerer = () => screen.getByText('Gérer l’agent').closest('details')!;
		const supprimerTravail = within(gerer()).getByRole('button', { name: 'Supprimer…' });
		expect(supprimerTravail.getAttribute('aria-disabled')).toBe('true');
		expect(description(supprimerTravail)).toBe('Fourni par Mnemo : il ne se supprime pas.');

		await choisir(liste, 'redaction');
		await act(async () => within(gerer()).getByRole('button', { name: 'Dupliquer…' }).click());
		fireEvent.change(within(gerer()).getByLabelText('Nom de la copie'), { target: { value: 'courriers' } });
		await act(async () => within(gerer()).getByRole('button', { name: 'Dupliquer' }).click());
		await screen.findByRole('complementary', { name: 'Agent courriers' });
		expect(caseInventaire('signature').getAttribute('aria-checked')).toBe('true');

		await act(async () => within(gerer()).getByRole('button', { name: 'Supprimer…' }).click());
		const confirmation = within(gerer()).getByRole('alert');
		expect(confirmation.textContent).toMatch(/Supprimer l’agent « courriers » et ses skills propres/u);
		await act(async () => within(confirmation).getByRole('button', { name: 'Supprimer' }).click());
		await screen.findByRole('complementary', { name: 'Agent travail' });
		await waitFor(() => expect(within(liste).queryByRole('button', { name: /^courriers/u })).toBeNull());
	});
});
