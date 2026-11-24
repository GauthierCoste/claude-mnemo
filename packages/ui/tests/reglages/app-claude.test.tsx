// @vitest-environment happy-dom
import type { ClaudeDesktopVue, ServeurMcpEcriture } from '@mnemo/contrat';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErreurApi } from '../../src/client/api.ts';
import { Application } from '../../src/composants/Application.tsx';
import { creerFauxClient } from '../aides/faux-client.tsx';
import { stockage } from '../aides/stockage.ts';

let stocke = new Map<string, string>();
beforeEach(() => {
	stocke = stockage();
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const FICHIER = '~/Library/Application Support/Claude/claude_desktop_config.json';
const RESTART = 'Redémarre l’app Claude pour prendre ce changement en compte.';

const VUE: ClaudeDesktopVue = {
	installee: true,
	fichier: FICHIER,
	mnemo: 'absent',
	serveurs: [
		{ nom: 'notes', commande: 'npx', args: ['-y', 'serveur-notes', 'Mes notes'], env: ['CLE_API'], modifiable: true },
		{ nom: 'distant', commande: 'https://exemple.test/mcp', args: [], env: [], modifiable: false },
	],
};

const REPONSES = {
	'/api/sessions': { sessions: [] },
	'/api/sante': { ok: true, pid: 1, racine: '~/Dossier', racineAbsolue: '/tmp/Dossier', terminaux: { ok: true }, version: '0.1.0' },
	'/api/fil': { commits: [], aConfirmer: [], montees: [], modifications: [] },
	'/api/memoire/graphe': { coffre: '_mnemo', fiches: [], liens: [], notions: [], sens: { disponible: false, etat: 'absent' }, modifieeMs: 0 },
	'/api/memoire/documents': { documents: [], aTraiter: [], totalDocuments: 0, totalATraiter: 0 },
	'/api/reglages': { champs: [], avertissements: [], enAttente: [] },
	'/api/claude-desktop': VUE,
};

/** Ouvre Réglages › App Claude ; rend le faux client et le panneau de l'onglet. */
async function ouvrirAppClaude(reponses: Record<string, unknown> = {}) {
	const faux = creerFauxClient({ ...REPONSES, ...reponses });
	render(<Application client={faux.client} />);
	const nav = screen.getByRole('navigation');
	await act(async () => within(nav).getByRole('button', { name: /Réglages/ }).click());
	await act(async () => screen.getByRole('tab', { name: 'App Claude' }).click());
	const panneau = await screen.findByRole('region', { name: 'App Claude' });
	return { faux, nav, panneau };
}

const section = (panneau: HTMLElement, titre: string) => within(panneau).getByRole('region', { name: titre });
const champ = (formulaire: HTMLElement, nom: string) => within(formulaire).getByRole('textbox', { name: new RegExp(`^${nom}`, 'u') }) as HTMLInputElement;
const saisir = (element: HTMLElement, valeur: string) => act(async () => fireEvent.change(element, { target: { value: valeur } }));

describe('Réglages › App Claude', () => {
	it('troisième onglet, retenu dans ce navigateur', async () => {
		await ouvrirAppClaude();
		expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Profils', 'Système', 'App Claude']);
		expect(screen.getByRole('tab', { name: 'App Claude' }).getAttribute('aria-selected')).toBe('true');
		expect(stocke.get('mnemo.reglages.onglet')).toBe('app-claude');
		cleanup();
		const faux = creerFauxClient(REPONSES);
		render(<Application client={faux.client} />);
		await act(async () => within(screen.getByRole('navigation')).getByRole('button', { name: /Réglages/ }).click());
		expect(screen.getByRole('tab', { name: 'App Claude' }).getAttribute('aria-selected')).toBe('true');
	});

	it('app Claude absente : le dire, rien d’autre', async () => {
		const { panneau } = await ouvrirAppClaude({ '/api/claude-desktop': { installee: false, fichier: FICHIER, mnemo: 'absent', serveurs: [] } });
		expect(within(panneau).getByText('L’app Claude n’est pas installée sur ce poste.')).toBeTruthy();
		expect(within(panneau).queryByRole('region', { name: 'Mémoire Mnemo' })).toBeNull();
		expect(within(panneau).queryByRole('button')).toBeNull();
	});

	it('fichier illisible : l’erreur et le chemin du fichier, aucune action', async () => {
		const { panneau } = await ouvrirAppClaude({ '/api/claude-desktop': { installee: true, fichier: FICHIER, erreur: 'Fichier de l’app Claude illisible : JSON invalide.', mnemo: 'absent', serveurs: [] } });
		const alerte = within(panneau).getByRole('alert');
		expect(alerte.textContent).toContain('JSON invalide');
		expect(alerte.textContent).toContain(FICHIER);
		expect(within(panneau).queryByRole('button')).toBeNull();
	});

	it('mémoire Mnemo : brancher, puis débrancher ; message de redémarrage après chaque écriture', async () => {
		const { faux, panneau } = await ouvrirAppClaude({
			'PUT /api/claude-desktop/mnemo': { ...VUE, mnemo: 'branche' },
			'DELETE /api/claude-desktop/mnemo': VUE,
		});
		const memoire = section(panneau, 'Mémoire Mnemo');
		expect(memoire.textContent).toContain('n’est pas branchée');
		expect(within(panneau).queryByText(RESTART)).toBeNull();
		await act(async () => within(memoire).getByRole('button', { name: 'Brancher la mémoire' }).click());
		expect(faux.api.remplacer).toHaveBeenCalledWith('/api/claude-desktop/mnemo', {});
		expect(memoire.textContent).toContain('est branchée sur l’app Claude');
		expect(within(panneau).getByRole('status').textContent).toBe(RESTART);
		await act(async () => within(memoire).getByRole('button', { name: 'Débrancher' }).click());
		expect(faux.api.supprimer).toHaveBeenCalledWith('/api/claude-desktop/mnemo');
		expect(within(memoire).getByRole('button', { name: 'Brancher la mémoire' })).toBeTruthy();
	});

	it('entrée périmée : « Mettre à jour » ; un refus du service est affiché', async () => {
		const { panneau } = await ouvrirAppClaude({
			'/api/claude-desktop': { ...VUE, mnemo: 'perime' },
			'PUT /api/claude-desktop/mnemo': () => {
				throw new ErreurApi('Fichier de l’app Claude illisible : jamais réécrit.', 409);
			},
		});
		const memoire = section(panneau, 'Mémoire Mnemo');
		expect(memoire.textContent).toContain('ne correspond plus');
		await act(async () => within(memoire).getByRole('button', { name: 'Mettre à jour' }).click());
		expect(within(memoire).getByRole('alert').textContent).toContain('jamais réécrit');
		expect(within(panneau).queryByText(RESTART)).toBeNull();
	});

	it('liste : commande et arguments en une ligne, noms des variables ; serveur décrit autrement en lecture seule (Retirer seulement)', async () => {
		const { panneau } = await ouvrirAppClaude();
		const serveurs = section(panneau, 'Autres serveurs MCP');
		const notes = within(serveurs).getByRole('listitem', { name: 'notes' });
		expect(notes.textContent).toContain('npx -y serveur-notes "Mes notes"');
		expect(notes.textContent).toContain('Variables : CLE_API');
		expect(within(notes).getByRole('button', { name: 'Modifier' })).toBeTruthy();
		const distant = within(serveurs).getByRole('listitem', { name: 'distant' });
		expect(distant.textContent).toContain('lecture seule');
		expect(within(distant).queryByRole('button', { name: 'Modifier' })).toBeNull();
		expect(within(distant).getByRole('button', { name: 'Retirer…' })).toBeTruthy();
	});

	it('retirer : confirmé dans la page (Garder, puis Retirer)', async () => {
		const { faux, panneau } = await ouvrirAppClaude({ 'DELETE /api/claude-desktop/serveurs/distant': { ...VUE, serveurs: [VUE.serveurs[0]!] } });
		const serveurs = section(panneau, 'Autres serveurs MCP');
		const distant = () => within(serveurs).getByRole('listitem', { name: 'distant' });
		await act(async () => within(distant()).getByRole('button', { name: 'Retirer…' }).click());
		const confirmation = within(distant()).getByRole('alert');
		expect(confirmation.textContent).toContain('Retirer le serveur « distant »');
		await act(async () => within(confirmation).getByRole('button', { name: 'Garder' }).click());
		expect(within(distant()).queryByRole('alert')).toBeNull();
		expect(faux.api.supprimer).not.toHaveBeenCalled();
		await act(async () => within(distant()).getByRole('button', { name: 'Retirer…' }).click());
		await act(async () => within(within(distant()).getByRole('alert')).getByRole('button', { name: 'Retirer' }).click());
		expect(faux.api.supprimer).toHaveBeenCalledWith('/api/claude-desktop/serveurs/distant');
		expect(within(serveurs).queryByRole('listitem', { name: 'distant' })).toBeNull();
		expect(within(panneau).getByRole('status').textContent).toBe(RESTART);
	});

	it('ajouter : nom, commande, arguments un par ligne, variables NOM=valeur ; nom déjà pris : le motif dans le formulaire', async () => {
		let corps: ServeurMcpEcriture | null = null;
		let refuser = true;
		const { panneau } = await ouvrirAppClaude({
			'/api/claude-desktop/serveurs': (_p: unknown, c: ServeurMcpEcriture) => {
				if (refuser) throw new ErreurApi(`Un serveur « ${c.nom} » existe déjà.`, 409);
				corps = c;
				return { ...VUE, serveurs: [...VUE.serveurs, { nom: c.nom, commande: c.commande, args: c.args, env: Object.keys(c.env), modifiable: true }] };
			},
		});
		const serveurs = section(panneau, 'Autres serveurs MCP');
		await act(async () => within(serveurs).getByRole('button', { name: 'Ajouter un serveur…' }).click());
		const formulaire = within(serveurs).getByRole('form', { name: 'Ajouter un serveur MCP' });
		await saisir(champ(formulaire, 'Nom'), 'outil');
		await saisir(champ(formulaire, 'Commande'), 'uvx');
		await saisir(champ(formulaire, 'Arguments'), 'outil-mcp\n--verbeux');
		await saisir(champ(formulaire, 'Variables'), 'JETON=abc');
		await act(async () => within(formulaire).getByRole('button', { name: 'Ajouter' }).click());
		expect(within(formulaire).getByRole('alert').textContent).toBe('Un serveur « outil » existe déjà.');
		refuser = false;
		await act(async () => within(formulaire).getByRole('button', { name: 'Ajouter' }).click());
		expect(corps).toEqual({ nom: 'outil', commande: 'uvx', args: ['outil-mcp', '--verbeux'], env: { JETON: 'abc' } });
		expect(within(serveurs).queryByRole('form')).toBeNull();
		expect(within(serveurs).getByRole('listitem', { name: 'outil' }).textContent).toContain('Variables : JETON');
		expect(panneau.textContent).not.toContain('abc');
		expect(within(panneau).getByRole('status').textContent).toBe(RESTART);
	});

	it('modifier : valeurs jamais montrées, NOM seul garde la valeur, nouveau nom envoyé à l’adresse de l’ancien', async () => {
		let corps: ServeurMcpEcriture | null = null;
		const { faux, panneau } = await ouvrirAppClaude({
			'PUT /api/claude-desktop/serveurs/notes': (_p: unknown, c: ServeurMcpEcriture) => {
				corps = c;
				return VUE;
			},
		});
		const serveurs = section(panneau, 'Autres serveurs MCP');
		await act(async () => within(within(serveurs).getByRole('listitem', { name: 'notes' })).getByRole('button', { name: 'Modifier' }).click());
		const formulaire = within(serveurs).getByRole('form', { name: 'Modifier le serveur « notes »' });
		expect(champ(formulaire, 'Nom').value).toBe('notes');
		expect(champ(formulaire, 'Arguments').value).toBe('-y\nserveur-notes\nMes notes');
		expect(champ(formulaire, 'Variables').value).toBe('CLE_API');
		// une variable nouvelle sans valeur : refusée avant tout envoi
		await saisir(champ(formulaire, 'Variables'), 'CLE_API\nAUTRE');
		await act(async () => within(formulaire).getByRole('button', { name: 'Enregistrer' }).click());
		expect(within(formulaire).getByRole('alert').textContent).toContain('AUTRE=valeur');
		expect(faux.api.remplacer).not.toHaveBeenCalled();
		await saisir(champ(formulaire, 'Nom'), 'notes-2');
		await saisir(champ(formulaire, 'Variables'), 'CLE_API\nAUTRE=1');
		await act(async () => within(formulaire).getByRole('button', { name: 'Enregistrer' }).click());
		expect(faux.api.remplacer).toHaveBeenCalledWith('/api/claude-desktop/serveurs/notes', expect.anything());
		expect(corps).toEqual({ nom: 'notes-2', commande: 'npx', args: ['-y', 'serveur-notes', 'Mes notes'], env: { CLE_API: null, AUTRE: '1' } });
		expect(within(serveurs).queryByRole('form')).toBeNull();
	});

	it('formulaire modifié : changer d’onglet est retenu ; quitter les Réglages propose d’enregistrer', async () => {
		const { faux, nav, panneau } = await ouvrirAppClaude();
		const serveurs = section(panneau, 'Autres serveurs MCP');
		await act(async () => within(serveurs).getByRole('button', { name: 'Ajouter un serveur…' }).click());
		const formulaire = within(serveurs).getByRole('form', { name: 'Ajouter un serveur MCP' });
		await saisir(champ(formulaire, 'Nom'), 'outil');
		// changer d'onglet : retenu
		await act(async () => screen.getByRole('tab', { name: 'Système' }).click());
		expect(screen.getByRole('tab', { name: 'App Claude' }).getAttribute('aria-selected')).toBe('true');
		const retenu = screen.getAllByRole('alert').find((a) => a.textContent?.includes('dans cet onglet'))!;
		await act(async () => within(retenu).getByRole('button', { name: 'Rester' }).click());
		expect(champ(formulaire, 'Nom').value).toBe('outil');
		// quitter la vue : avertissement dans le formulaire ; Abandonner part sans rien écrire
		const sessions = () => within(nav).getByRole('button', { name: /Sessions/ });
		await act(async () => sessions().click());
		const alerte = within(formulaire).getByRole('alert');
		expect(alerte.textContent).toContain('Serveur MCP non enregistré');
		await act(async () => within(alerte).getByRole('button', { name: 'Abandonner' }).click());
		expect(sessions().getAttribute('aria-current')).toBe('page');
		expect(faux.api.envoyer).not.toHaveBeenCalled();
	});

	it('formulaire annulé : changer d’onglet n’est plus retenu', async () => {
		const { panneau } = await ouvrirAppClaude();
		const serveurs = section(panneau, 'Autres serveurs MCP');
		await act(async () => within(serveurs).getByRole('button', { name: 'Ajouter un serveur…' }).click());
		await saisir(champ(within(serveurs).getByRole('form'), 'Nom'), 'outil');
		await act(async () => within(serveurs).getByRole('button', { name: 'Annuler' }).click());
		await act(async () => screen.getByRole('tab', { name: 'Système' }).click());
		expect(screen.getByRole('tab', { name: 'Système' }).getAttribute('aria-selected')).toBe('true');
	});
});
