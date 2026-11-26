// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROUTES, type ReponseLiaisonMoteur, type ReponseMoteurs } from '@mnemo/contrat';
import { ErreurApi } from '../../src/client/api.ts';
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

/** Les lignes de description d'un choix, dans l'ordre de son `aria-describedby`. */
const lignes = (choix: HTMLElement): HTMLElement[] => (choix.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)!);

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

	it('chaque choix : son nom seul comme libellé, sa ligne d’état puis sa ligne d’effet comme description (aria-describedby : les deux, lues une fois)', async () => {
		const editeur = await choisirProfil('revue-code');
		const codex = within(moteur(editeur)).getByRole('radio', { name: 'Codex · OpenAI' });
		// la description se complète quand les moteurs sont chargés (version) : attendue, sans course
		const description = () => lignes(codex);
		await waitFor(() => expect(description()[0]?.textContent).toBe('version 0.171.0-alpha.13'));
		expect(description()).toHaveLength(2);
		expect(description()[1]?.textContent).toMatch(/^skills listées dans la consigne/u);
		for (const l of description()) {
			expect(l.textContent).not.toMatch(/[—·]/u);
			expect(l.closest('label')).toBeNull();
		}
	});

	it('Mistral Vibe : sa version, ses effets (ce qui lui manque compris), ses modèles proposés ; un profil Vibe les montre', async () => {
		const editeur = await choisirProfil('veille-technique');
		const groupe = moteur(editeur);
		expect((within(groupe).getByRole('radio', { name: 'Mistral Vibe · Mistral' }) as HTMLInputElement).checked).toBe(true);
		const description = (nom: string) => lignes(within(groupe).getByRole('radio', { name: nom }));
		await waitFor(() => expect(description('Mistral Vibe · Mistral')[0]?.textContent).toBe('version 3.1.5'));
		expect(description('Mistral Vibe · Mistral')[1]?.textContent).toMatch(/ni plugins, ni quotas de l’abonnement$/u);
		expect(modele(editeur).value).toBe('mistral-medium-3.5');
		const proposes = await within(editeur).findByRole('group', { name: 'Modèles proposés par Mistral Vibe' });
		expect(within(proposes).getAllByRole('button').map((b) => b.textContent)).toEqual(['mistral-large-4-0', 'mistral-medium-3.5']);
		expect(within(editeur).queryByText('Plugins Claude Code')).toBeNull();
		expect(await within(editeur).findByText('Skills de Mistral Vibe')).toBeTruthy();
		// passer à Codex : modèle par défaut, ses modèles proposés, l'aperçu suit une fois enregistré
		await act(async () => within(groupe).getByRole('radio', { name: 'Codex · OpenAI' }).click());
		expect(modele(editeur).value).toBe('');
		expect(modele(editeur).placeholder).toBe('par défaut de Codex');
		const deCodex = await within(editeur).findByRole('group', { name: 'Modèles proposés par Codex' });
		expect(within(deCodex).getAllByRole('button').map((b) => b.textContent)).toEqual(['gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-6.1-terra']);
	});

	it('archiviste : Mistral Vibe réservé, comme Codex', async () => {
		const archiviste = await choisirProfil('archiviste');
		for (const nom of ['Codex · OpenAI', 'Mistral Vibe · Mistral']) {
			const radio = within(moteur(archiviste)).getByRole('radio', { name: nom }) as HTMLInputElement;
			expect(radio.disabled).toBe(true);
			expect(document.getElementById(radio.getAttribute('aria-describedby')!)?.textContent).toBe('Réservé : l’archiviste reste sur Claude Code.');
		}
	});

	it('aller-retour de moteur : le modèle saisi pour chacun est gardé pendant l’édition', async () => {
		const editeur = await choisirProfil('revue-code');
		fireEvent.change(modele(editeur), { target: { value: 'gpt-6.2-astra' } });
		await act(async () => within(moteur(editeur)).getByRole('radio', { name: 'Claude Code · Anthropic' }).click());
		fireEvent.change(modele(editeur), { target: { value: 'sonnet' } });
		await act(async () => within(moteur(editeur)).getByRole('radio', { name: 'Codex · OpenAI' }).click());
		expect(modele(editeur).value).toBe('gpt-6.2-astra');
		await act(async () => within(moteur(editeur)).getByRole('radio', { name: 'Claude Code · Anthropic' }).click());
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


/** Réglages › Système › Moteurs de la démo : la section des moteurs, une fois les cartes affichées. */
async function ouvrirMoteurs(client: Client = creerClientDemo()): Promise<HTMLElement> {
	await ouvrirReglages(client);
	await act(async () => screen.getByRole('tab', { name: 'Système' }).click());
	const page = await screen.findByRole('form', { name: 'Réglages système' });
	await act(async () => within(within(page).getByRole('navigation', { name: 'Groupes de réglages' })).getByRole('button', { name: /^Moteurs/u }).click());
	const section = within(page).getByRole('region', { name: 'Moteurs' });
	await within(section).findByRole('region', { name: /^Mistral Vibe /u });
	return section;
}

const carte = (section: HTMLElement, nom: string): HTMLElement => within(section).getByRole('region', { name: new RegExp(`^${nom} `, 'u') });
/** Les étapes du circuit d'une carte : nom, valeur, état (`data-etat`). */
const etapes = (c: HTMLElement) =>
	within(within(c).getByRole('list', { name: /^Circuit de liaison de / })).getAllByRole('listitem').map((li) => ({ texte: li.textContent, etat: li.getAttribute('data-etat') }));

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

describe('Réglages › Système › Moteurs', () => {
	it('une carte par moteur : nom, fournisseur, statut en un mot ; équipe et modèles ; pas de pied Enregistrer', async () => {
		const section = await ouvrirMoteurs();
		expect(within(section).getAllByRole('region').map((r) => r.getAttribute('aria-labelledby')?.split(' ').map((id) => document.getElementById(id)?.textContent).join(' '))).toEqual([
			'Claude Code Prêt',
			'Codex À approuver',
			'Mistral Vibe À lier',
		]);
		expect(within(section).getByText('Les agents de code qui font tourner les sessions, un par fournisseur. Un moteur est prêt quand son circuit est allumé jusqu’au bout.')).toBeTruthy();
		const vibe = carte(section, 'Mistral Vibe');
		expect(within(vibe).getByText('Mistral')).toBeTruthy();
		// équipe : les profils qui tournent sur ce moteur
		expect(within(within(vibe).getByRole('list', { name: 'Profils sur Mistral Vibe' })).getByRole('img', { name: 'veille-technique' })).toBeTruthy();
		expect(within(carte(section, 'Codex')).getByRole('img', { name: 'revue-code' })).toBeTruthy();
		expect(within(within(vibe).getByRole('list', { name: 'Modèles de Mistral Vibe' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['mistral-large-4-0', 'mistral-medium-3.5']);
		const page = screen.getByRole('form', { name: 'Réglages système' });
		expect(within(page).queryByRole('button', { name: 'Enregistrer' })).toBeNull();
		expect(within(page).queryByRole('button', { name: 'Annuler les modifications' })).toBeNull();
	});

	it('circuit : Installé → Version → Mémoire → Suivi (→ Approbation) ; la première étape cassée, son état dit en texte', async () => {
		const section = await ouvrirMoteurs();
		expect(etapes(carte(section, 'Mistral Vibe'))).toEqual([
			{ texte: '✓Installé~/.local/bin/vibe(satisfait)', etat: 'ok' },
			{ texte: '✓Version3.1.5(satisfait)', etat: 'ok' },
			{ texte: '3Mémoirenon déclaré(à régler)', etat: 'casse' },
			{ texte: '4Suivinon installés(en attente)', etat: 'attente' },
		]);
		const codex = etapes(carte(section, 'Codex'));
		expect(codex.map((e) => e.etat)).toEqual(['ok', 'ok', 'ok', 'ok', 'casse']);
		expect(codex[4]!.texte).toBe('5Approbationà approuver(à régler)');
		// le détail en infobulle
		const memoire = within(carte(section, 'Mistral Vibe')).getByText('Mémoire').closest('li')!;
		expect(memoire.getAttribute('title')).toBe('Serveur MCP mnemo : non déclaré. Les sessions de Mistral Vibe lancées hors de Mnemo ne lisent pas la mémoire.');
		// un moteur prêt : aucun encadré d'action
		expect(within(carte(section, 'Claude Code')).queryByRole('button', { name: 'Lier à Mnemo' })).toBeNull();
	});

	it('« Lier à Mnemo » : désactivé avec « Liaison… » pendant l’appel ; puis le circuit allumé, « Prêt » et le toast', async () => {
		const section = await ouvrirMoteurs();
		const vibe = carte(section, 'Mistral Vibe');
		expect(within(vibe).getByText('Mistral Vibe n’est pas lié à Mnemo.')).toBeTruthy();
		expect(within(vibe).getByText('mnemo declarer --moteur mistral-vibe --lier').tagName).toBe('CODE');
		await act(async () => within(vibe).getByRole('button', { name: 'Lier à Mnemo' }).click());
		const enCours = within(vibe).getByRole('button', { name: 'Liaison…' }) as HTMLButtonElement;
		expect(enCours.disabled).toBe(true);
		expect(enCours.firstElementChild!.className).toMatch(/reflet/u);
		expect(await screen.findByText('Mistral Vibe lié à Mnemo.', {}, { timeout: 3000 })).toBeTruthy();
		const apres = carte(section, 'Mistral Vibe');
		expect(etapes(apres).map((e) => e.etat)).toEqual(['ok', 'ok', 'ok', 'ok']);
		expect(within(apres).queryByRole('button', { name: /Lier à Mnemo|Liaison…/u })).toBeNull();
	});

	it('déclaration de l’utilisateur laissée : ses messages dans l’encadré, sans toast « lié »', async () => {
		const client = creerClientDemo();
		lierRend(client, {
			id: 'mistral-vibe',
			lie: false,
			ok: true,
			mcp: { resultat: 'laisse', message: 'Une déclaration MCP « mnemo » qui ne lance pas Mnemo existe chez Mistral Vibe : laissée telle quelle.' },
			hooks: { resultat: 'installe', message: 'Hooks de Mnemo installés chez Mistral Vibe.' },
		});
		const section = await ouvrirMoteurs(client);
		await act(async () => within(carte(section, 'Mistral Vibe')).getByRole('button', { name: 'Lier à Mnemo' }).click());
		const statut = await within(carte(section, 'Mistral Vibe')).findByRole('status');
		expect(statut.textContent).toBe('Une déclaration MCP « mnemo » qui ne lance pas Mnemo existe chez Mistral Vibe : laissée telle quelle.');
		expect(screen.queryByText('Mistral Vibe lié à Mnemo.')).toBeNull();
		expect((within(carte(section, 'Mistral Vibe')).getByRole('button', { name: 'Lier à Mnemo' }) as HTMLButtonElement).disabled).toBe(false);
	});

	it('échec : l’étape en échec, ou le refus du service (409), en alerte', async () => {
		const client = creerClientDemo();
		const espion = lierRend(client, { id: 'mistral-vibe', lie: false, ok: false, mcp: { resultat: 'echec', message: 'Déclaration automatique à Mistral Vibe impossible (délai dépassé).' } });
		const section = await ouvrirMoteurs(client);
		await act(async () => within(carte(section, 'Mistral Vibe')).getByRole('button', { name: 'Lier à Mnemo' }).click());
		expect((await within(carte(section, 'Mistral Vibe')).findByRole('alert')).textContent).toBe('Déclaration automatique à Mistral Vibe impossible (délai dépassé).');
		espion.mockRestore();
		lierRend(client, new ErreurApi('Liaison de Mistral Vibe à Mnemo déjà en cours.', 409));
		await act(async () => within(carte(section, 'Mistral Vibe')).getByRole('button', { name: 'Lier à Mnemo' }).click());
		await waitFor(() => expect(within(carte(section, 'Mistral Vibe')).getByRole('alert').textContent).toBe('Liaison de Mistral Vibe à Mnemo déjà en cours.'));
		expect(screen.queryByText('Mistral Vibe lié à Mnemo.')).toBeNull();
	});

	it('liaison partielle (serveur MCP déclaré, hooks en échec) : l’étape qui bloque passe à Suivi, le message d’échec reste', async () => {
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
		await act(async () => within(carte(section, 'Mistral Vibe')).getByRole('button', { name: 'Lier à Mnemo' }).click());
		await waitFor(() => expect(etapes(carte(section, 'Mistral Vibe')).map((e) => e.etat)).toEqual(['ok', 'ok', 'ok', 'casse']));
		expect(within(carte(section, 'Mistral Vibe')).getByRole('alert').textContent).toBe('Hooks de Mistral Vibe illisibles : fichier refusé.');
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
		expect((within(carte(section, 'Mistral Vibe')).getByRole('button', { name: 'Lier à Mnemo' }) as HTMLButtonElement).disabled).toBe(true);
		await act(async () => enAttente[0]!());
		await waitFor(() => expect((within(carte(section, 'Mistral Vibe')).getByRole('button', { name: 'Lier à Mnemo' }) as HTMLButtonElement).disabled).toBe(false));
	});

	it('moteur pas installé : éteint (sans la couleur de son fournisseur), « Nouveau profil » indisponible avec sa raison ; Claude Code manuel, lui, reste utilisable', async () => {
		const client = creerClientDemo();
		lireRetouche(client, (r) => {
			for (const m of r.moteurs.filter((x) => x.id !== 'mistral-vibe')) {
				m.indisponible = `${m.nom} introuvable sur ce poste.`;
				m.manuel = m.id === 'claude-code';
				m.poste = [{ cle: 'commande', libelle: 'Commande', ok: false, etat: 'introuvable', detail: `${m.nom} absent du PATH` }];
			}
		});
		const section = await ouvrirMoteurs(client);
		await waitFor(() => expect(carte(section, 'Codex').getAttribute('aria-labelledby')!.split(' ').map((id) => document.getElementById(id)?.textContent)).toEqual(['Codex', 'Pas installé']));
		const codex = carte(section, 'Codex');
		expect(codex.hasAttribute('data-absent')).toBe(true);
		expect(codex.style.getPropertyValue('--c')).toBe('');
		expect(within(codex).getByText('Pas installé sur ce poste.')).toBeTruthy();
		const nouveau = within(codex).getByRole('button', { name: 'Nouveau profil sur Codex' });
		expect(nouveau.getAttribute('aria-disabled')).toBe('true');
		expect(document.getElementById(nouveau.getAttribute('aria-describedby')!)?.textContent).toBe('Pas installé sur ce poste');
		await act(async () => nouveau.click());
		expect(screen.getByRole('tab', { name: 'Système' }).getAttribute('aria-selected')).toBe('true');
		const claude = within(carte(section, 'Claude Code')).getByRole('button', { name: 'Nouveau profil sur Claude Code' });
		expect(claude.getAttribute('aria-disabled')).toBeNull();
		expect(carte(section, 'Mistral Vibe').style.getPropertyValue('--c')).toBe('var(--fournisseur-mistral)');
	});

	it('Codex à approuver : « Copier « /hooks » » copie la commande à taper dans Codex', async () => {
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		const section = await ouvrirMoteurs();
		const codex = carte(section, 'Codex');
		expect(within(codex).getByText('Hooks à approuver dans Codex.')).toBeTruthy();
		expect(within(codex).getByText('À taper dans Codex :')).toBeTruthy();
		expect(within(codex).queryByRole('button', { name: 'Lier à Mnemo' })).toBeNull();
		await act(async () => within(codex).getByRole('button', { name: 'Copier « /hooks »' }).click());
		expect(writeText).toHaveBeenCalledWith('/hooks');
		expect(await screen.findByText('Commande copiée.')).toBeTruthy();
	});

	it('« Nouveau profil » d’un moteur : Réglages › Profils, création d’un profil qui tournera sur lui', async () => {
		const client = creerClientDemo();
		const remplacer = vi.spyOn(client.api, 'remplacer');
		const section = await ouvrirMoteurs(client);
		await act(async () => within(carte(section, 'Mistral Vibe')).getByRole('button', { name: 'Nouveau profil sur Mistral Vibe' }).click());
		expect(screen.getByRole('tab', { name: 'Profils' }).getAttribute('aria-selected')).toBe('true');
		const liste = await screen.findByRole('navigation', { name: 'Profils' });
		expect(document.activeElement).toBe(within(liste).getByLabelText('Nom du nouveau profil'));
		expect(screen.getByText(/Il tournera sur Mistral Vibe/u)).toBeTruthy();
		fireEvent.change(within(liste).getByLabelText('Nom du nouveau profil'), { target: { value: 'vibe-essai' } });
		await act(async () => within(liste).getByRole('button', { name: 'Créer' }).click());
		await screen.findByRole('form', { name: 'Profil vibe-essai' });
		const [chemin, corps] = remplacer.mock.calls.find(([c]) => c === ROUTES.profil.replace(':id', 'vibe-essai'))!;
		expect(chemin).toBe(ROUTES.profil.replace(':id', 'vibe-essai'));
		expect((corps as { editable: { moteur: string } }).editable.moteur).toBe('mistral-vibe');
	});

	it('« Relire » : désactivé, section occupée et « Vérification… » pendant chaque lecture ; l’heure de la vérification ; la carte relue', async () => {
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
		await act(async () => screen.getByRole('tab', { name: 'Système' }).click());
		const page = await screen.findByRole('form', { name: 'Réglages système' });
		await act(async () => within(within(page).getByRole('navigation', { name: 'Groupes de réglages' })).getByRole('button', { name: /^Moteurs/u }).click());
		const section = within(page).getByRole('region', { name: 'Moteurs' });
		const relire = within(section).getByRole('button', { name: 'Relire' }) as HTMLButtonElement;
		await waitFor(() => expect(lectures).toBe(1));
		expect(relire.disabled).toBe(true);
		expect(section.getAttribute('aria-busy')).toBe('true');
		const statut = () => within(section).getAllByRole('status')[0]!.textContent;
		expect(statut()).toBe('Vérification des moteurs… (quelques secondes)');
		await act(async () => liberer());
		await waitFor(() => expect(relire.disabled).toBe(false));
		expect(statut()).toMatch(/^Vérifié à \d\d:\d\d$/u);
		const codex = carte(section, 'Codex');
		expect(codex.getAttribute('aria-labelledby')!.split(' ').map((id) => document.getElementById(id)?.textContent)).toEqual(['Codex', 'Introuvable']);
		expect(within(codex).getByText('Codex introuvable maintenant.')).toBeTruthy();
		expect(within(codex).getByText(/commande disparue/u)).toBeTruthy();
		await act(async () => relire.click());
		await waitFor(() => expect(lectures).toBe(2));
		expect(relire.disabled).toBe(true);
		expect(section.getAttribute('aria-busy')).toBe('true');
		expect(statut()).toBe('Vérification…');
		await act(async () => liberer());
		await waitFor(() => expect(relire.disabled).toBe(false));
	});
});
