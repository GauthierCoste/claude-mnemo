// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROUTES, type ReponseLiaisonMoteur, type ReponseMoteurs } from '@mnemo/contrat';
import { ErreurApi } from '../../src/client/api.ts';
import type { Client } from '../../src/client/contexte.tsx';
import { creerClientDemo } from '../../src/client/demo.ts';
import { Application } from '../../src/composants/Application.tsx';

// Les terminaux de la vue Sessions (restée montée) : huit xterm injecteraient ~440 Ko de CSS et réécriraient le DOM en
// continu ; chaque requête par rôle recalculerait alors les styles (50 à 150 ms l'une). Un simple champ les remplace.
vi.mock('../../src/terminal/Terminal.tsx', () => ({ Terminal: (p: { session: string }) => <textarea aria-label={`terminal ${p.session}`} readOnly /> }));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

/** Réglages de la démo ouverts (onglet Agents d'abord). */
async function ouvrirReglages(client: Client = creerClientDemo()) {
	render(<Application client={client} />);
	const nav = screen.getByRole('navigation');
	await act(async () => within(nav).getByRole('button', { name: /Réglages/ }).click());
	return screen.findByRole('navigation', { name: 'Agents' });
}

/**
 * Réglages › Branchements de la démo (la section par défaut de l'onglet Réglages) : le groupe Moteurs, une fois les lignes
 * affichées et la vérification du poste terminée (pendant, « Lier à Mnemo » est indisponible).
 */
async function ouvrirMoteurs(client: Client = creerClientDemo()): Promise<HTMLElement> {
	await ouvrirReglages(client);
	await act(async () => screen.getByRole('tab', { name: 'Réglages' }).click());
	const section = await screen.findByRole('region', { name: 'Moteurs' });
	await within(section).findByRole('listitem', { name: 'Mistral Vibe' });
	await waitFor(() => expect(section.getAttribute('aria-busy')).not.toBe('true'));
	return section;
}

const ligne = (section: HTMLElement, nom: string): HTMLElement => within(section).getByRole('listitem', { name: nom });
/** Nom, puis fournisseur et statut, d'une ligne de moteur. */
const identite = (l: HTMLElement): string => l.querySelector('span:nth-child(2)')!.textContent ?? '';
/** La pastille ambre de la section Branchements (un moteur attend un geste). */
const pastille = (): Element | null => within(screen.getByRole('navigation', { name: 'Sections des réglages' })).getByRole('button', { name: /^Branchements/u }).querySelector('[title="Un moteur attend un geste"]');

/** Liaison rendue par le service pour Mistral Vibe, avec les moteurs relus (inchangés, ou retouchés par `relus`). */
function lierRend(client: Client, liaison: ReponseLiaisonMoteur['liaison'] | Error, relus?: (r: ReponseMoteurs) => void) {
	const envoyer = client.api.envoyer.bind(client.api);
	return vi.spyOn(client.api, 'envoyer').mockImplementation(async (chemin, corps) => {
		if (chemin !== ROUTES.moteurLier.replace(':id', 'mistral-vibe')) return envoyer(chemin, corps);
		if (liaison instanceof Error) throw liaison;
		const r = await client.api.lire<ReponseMoteurs>(ROUTES.moteurs, { poste: '1' });
		relus?.(r);
		return { moteurs: r.moteurs, liaison } satisfies ReponseLiaisonMoteur as never;
	});
}

/** Les moteurs lus avec le poste, retouchés par `retoucher`. */
function lireRetouche(client: Client, retoucher: (r: ReponseMoteurs) => void) {
	const lire = client.api.lire.bind(client.api);
	vi.spyOn(client.api, 'lire').mockImplementation(async (chemin, params, options) => {
		const r = await lire<ReponseMoteurs>(chemin, params, options);
		if (chemin === ROUTES.moteurs && params?.['poste'] === '1') retoucher(r);
		return r as never;
	});
}

describe('Réglages › Branchements › Moteurs', () => {
	it('une ligne par moteur : logo, nom, fournisseur et statut ; « prêt », ou le geste à droite ; pas de pied Enregistrer ; la pastille ambre', async () => {
		const section = await ouvrirMoteurs();
		expect(within(section).getAllByRole('listitem').map((l) => l.getAttribute('aria-label'))).toEqual(['Claude Code', 'Codex', 'Mistral Vibe']);
		expect(identite(ligne(section, 'Claude Code'))).toBe('Claude CodeAnthropic');
		expect(within(ligne(section, 'Claude Code')).getByText('● prêt')).toBeTruthy();
		expect(identite(ligne(section, 'Codex'))).toBe('CodexOpenAI · à approuver');
		expect(identite(ligne(section, 'Mistral Vibe'))).toBe('Mistral VibeMistral · à lier');
		// le logo du fournisseur, embarqué, caché aux lecteurs d'écran (le nom est écrit à côté)
		expect([...section.querySelectorAll('svg')].map((x) => [x.getAttribute('data-fournisseur'), x.getAttribute('aria-hidden')])).toEqual([
			['Anthropic', 'true'],
			['OpenAI', 'true'],
			['Mistral', 'true'],
		]);
		expect(within(screen.getByRole('tabpanel')).queryByRole('button', { name: 'Enregistrer' })).toBeNull();
		// un moteur attend un geste : la pastille sur l'onglet Réglages et sur Branchements
		expect(pastille()).not.toBeNull();
		expect(within(screen.getByRole('navigation', { name: 'Sections des réglages' })).getByRole('button', { name: /^Branchements/u }).textContent).toContain('(un moteur attend un geste)');
		const onglet = screen.getByRole('tab', { name: 'Réglages' });
		expect(document.getElementById(onglet.getAttribute('aria-describedby')!)?.textContent).toBe('Un moteur attend un geste (Branchements)');
	});

	it('« Lier à Mnemo » : désactivé avec « Liaison… » pendant l’appel ; puis « prêt » et le toast', async () => {
		const section = await ouvrirMoteurs();
		const vibe = ligne(section, 'Mistral Vibe');
		expect(within(vibe).getByText(/Mistral Vibe n’est pas lié à Mnemo\./u)).toBeTruthy();
		expect(within(vibe).getByText('mnemo declarer --moteur mistral-vibe --lier').tagName).toBe('CODE');
		await act(async () => within(vibe).getByRole('button', { name: 'Lier à Mnemo' }).click());
		const enCours = within(vibe).getByRole('button', { name: 'Liaison…' }) as HTMLButtonElement;
		expect(enCours.disabled).toBe(true);
		expect(enCours.firstElementChild!.className).toMatch(/reflet/u);
		expect(await screen.findByText('Mistral Vibe lié à Mnemo.', {}, { timeout: 3000 })).toBeTruthy();
		const apres = ligne(section, 'Mistral Vibe');
		expect(identite(apres)).toBe('Mistral VibeMistral');
		expect(within(apres).getByText('● prêt')).toBeTruthy();
		expect(within(apres).queryByRole('button', { name: /Lier à Mnemo|Liaison…/u })).toBeNull();
	});

	it('déclaration de l’utilisateur laissée : ses messages sous la ligne, sans toast « lié »', async () => {
		const client = creerClientDemo();
		lierRend(client, {
			id: 'mistral-vibe',
			lie: false,
			ok: true,
			mcp: { resultat: 'laisse', message: 'Une déclaration MCP « mnemo » qui ne lance pas Mnemo existe chez Mistral Vibe : laissée telle quelle.' },
			hooks: { resultat: 'installe', message: 'Hooks de Mnemo installés chez Mistral Vibe.' },
		});
		const section = await ouvrirMoteurs(client);
		await act(async () => within(ligne(section, 'Mistral Vibe')).getByRole('button', { name: 'Lier à Mnemo' }).click());
		const statut = await within(ligne(section, 'Mistral Vibe')).findByRole('status');
		expect(statut.textContent).toBe('Une déclaration MCP « mnemo » qui ne lance pas Mnemo existe chez Mistral Vibe : laissée telle quelle.');
		expect(screen.queryByText('Mistral Vibe lié à Mnemo.')).toBeNull();
		expect((within(ligne(section, 'Mistral Vibe')).getByRole('button', { name: 'Lier à Mnemo' }) as HTMLButtonElement).disabled).toBe(false);
	});

	it('échec : l’étape en échec, ou le refus du service (409), en alerte', async () => {
		const client = creerClientDemo();
		const espion = lierRend(client, { id: 'mistral-vibe', lie: false, ok: false, mcp: { resultat: 'echec', message: 'Déclaration automatique à Mistral Vibe impossible (délai dépassé).' } });
		const section = await ouvrirMoteurs(client);
		await act(async () => within(ligne(section, 'Mistral Vibe')).getByRole('button', { name: 'Lier à Mnemo' }).click());
		expect((await within(ligne(section, 'Mistral Vibe')).findByRole('alert')).textContent).toBe('Déclaration automatique à Mistral Vibe impossible (délai dépassé).');
		espion.mockRestore();
		lierRend(client, new ErreurApi('Liaison de Mistral Vibe à Mnemo déjà en cours.', 409));
		await act(async () => within(ligne(section, 'Mistral Vibe')).getByRole('button', { name: 'Lier à Mnemo' }).click());
		await waitFor(() => expect(within(ligne(section, 'Mistral Vibe')).getByRole('alert').textContent).toBe('Liaison de Mistral Vibe à Mnemo déjà en cours.'));
		expect(screen.queryByText('Mistral Vibe lié à Mnemo.')).toBeNull();
	});

	it('liaison partielle (serveur MCP déclaré, hooks en échec) : ce qui bloque passe aux hooks, le message d’échec reste', async () => {
		const client = creerClientDemo();
		lierRend(
			client,
			{
				id: 'mistral-vibe',
				lie: false,
				ok: false,
				mcp: { resultat: 'declare', message: 'Serveur MCP déclaré pour toutes les sessions Mistral Vibe.' },
				hooks: { resultat: 'echec', message: 'Hooks de Mistral Vibe illisibles : fichier refusé.' },
			},
			(r) => {
				const points = r.moteurs.find((m) => m.id === 'mistral-vibe')!.poste!;
				points[2] = { cle: 'mcp', libelle: 'Serveur MCP mnemo', ok: true, etat: 'déclaré' };
			},
		);
		const section = await ouvrirMoteurs(client);
		await act(async () => within(ligne(section, 'Mistral Vibe')).getByRole('button', { name: 'Lier à Mnemo' }).click());
		await waitFor(() => expect(ligne(section, 'Mistral Vibe').textContent).not.toMatch(/ne lisent pas la mémoire/u));
		expect(within(ligne(section, 'Mistral Vibe')).getByText('Mistral Vibe n’est pas lié à Mnemo. Mnemo ne suit pas ses sessions.')).toBeTruthy();
		expect(within(ligne(section, 'Mistral Vibe')).getByRole('alert').textContent).toBe('Hooks de Mistral Vibe illisibles : fichier refusé.');
	});

	it('« Lier à Mnemo » indisponible pendant une vérification du poste (« Relire »)', async () => {
		const client = creerClientDemo();
		const section = await ouvrirMoteurs(client);
		const lire = client.api.lire.bind(client.api);
		const enAttente: (() => void)[] = [];
		vi.spyOn(client.api, 'lire').mockImplementation(async (chemin, params, options) => {
			const r = await lire(chemin, params, options);
			if (chemin === ROUTES.moteurs && params?.['poste'] === '1') await new Promise<void>((f) => enAttente.push(f));
			return r as never;
		});
		await act(async () => within(section).getByRole('button', { name: 'Relire' }).click());
		await waitFor(() => expect(enAttente).toHaveLength(1));
		expect((within(ligne(section, 'Mistral Vibe')).getByRole('button', { name: 'Lier à Mnemo' }) as HTMLButtonElement).disabled).toBe(true);
		await act(async () => enAttente[0]!());
		await waitFor(() => expect((within(ligne(section, 'Mistral Vibe')).getByRole('button', { name: 'Lier à Mnemo' }) as HTMLButtonElement).disabled).toBe(false));
	});

	it('moteur pas installé : son statut atténué, sans geste, et pas de pastille (rien à faire dans Mnemo)', async () => {
		const client = creerClientDemo();
		lireRetouche(client, (r) => {
			for (const m of r.moteurs.filter((x) => x.id !== 'claude-code')) {
				m.indisponible = `${m.nom} introuvable sur ce poste.`;
				m.poste = [{ cle: 'commande', libelle: 'Commande', ok: false, etat: 'introuvable', detail: `${m.nom} absent du PATH` }];
			}
		});
		await ouvrirReglages(client);
		await act(async () => screen.getByRole('tab', { name: 'Réglages' }).click());
		const section = await screen.findByRole('region', { name: 'Moteurs' });
		// dit une seule fois, dans la phrase sous la ligne
		await waitFor(() => expect(within(ligne(section, 'Codex')).getByText('Pas installé sur ce poste. Codex absent du PATH')).toBeTruthy());
		const codex = ligne(section, 'Codex');
		expect(identite(codex)).toBe('CodexOpenAI');
		expect(codex.textContent!.match(/pas installé/giu)).toHaveLength(1);
		expect(within(codex).queryByRole('button')).toBeNull();
		expect(pastille()).toBeNull();
		expect(screen.getByRole('tab', { name: 'Réglages' }).getAttribute('aria-describedby')).toBeNull();
	});

	it('Codex à approuver : « Copier « /hooks » » copie la commande à taper dans Codex', async () => {
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		const section = await ouvrirMoteurs();
		const codex = ligne(section, 'Codex');
		expect(within(codex).getByText(/Hooks à approuver dans Codex\./u)).toBeTruthy();
		expect(within(codex).getByText('À taper dans Codex :')).toBeTruthy();
		expect(within(codex).queryByRole('button', { name: 'Lier à Mnemo' })).toBeNull();
		await act(async () => within(codex).getByRole('button', { name: 'Copier « /hooks »' }).click());
		expect(writeText).toHaveBeenCalledWith('/hooks');
		expect(await screen.findByText('Commande copiée.')).toBeTruthy();
	});

	it('« Relire » : désactivé, groupe occupé et « Vérification… » pendant chaque lecture ; l’heure de la vérification ; la ligne relue', async () => {
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
			codex.poste![0] = { cle: 'commande', libelle: 'Commande', ok: false, etat: 'introuvable maintenant', detail: 'commande disparue' };
			return r as never;
		});
		await ouvrirReglages(client);
		await act(async () => screen.getByRole('tab', { name: 'Réglages' }).click());
		const section = screen.getByRole('region', { name: 'Moteurs' });
		const relire = within(section).getByRole('button', { name: 'Relire' }) as HTMLButtonElement;
		await waitFor(() => expect(lectures).toBe(1));
		expect(relire.disabled).toBe(true);
		expect(section.getAttribute('aria-busy')).toBe('true');
		const statut = () => within(section).getAllByRole('status')[0]!.textContent;
		expect(statut()).toBe('Vérification des moteurs… (quelques secondes)');
		await act(async () => liberer());
		await waitFor(() => expect(relire.disabled).toBe(false));
		expect(statut()).toMatch(/^Vérifié à \d\d:\d\d$/u);
		const codex = ligne(section, 'Codex');
		expect(identite(codex)).toBe('CodexOpenAI');
		expect(within(codex).getByText('Codex introuvable maintenant. commande disparue')).toBeTruthy();
		await act(async () => relire.click());
		await waitFor(() => expect(lectures).toBe(2));
		expect(relire.disabled).toBe(true);
		expect(section.getAttribute('aria-busy')).toBe('true');
		expect(statut()).toBe('Vérification…');
		await act(async () => liberer());
		await waitFor(() => expect(relire.disabled).toBe(false));
	});
});
