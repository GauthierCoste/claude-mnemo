// @vitest-environment happy-dom
import type { ChampReglageVue, ReglagesVue } from '@mnemo/contrat';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErreurApi } from '../../src/client/api.ts';
import { Application } from '../../src/composants/Application.tsx';
import { creerFauxClient } from '../aides/faux-client.tsx';
import { stockage } from '../aides/stockage.ts';

// Les terminaux de la vue Sessions (restée montée) : huit xterm injecteraient ~440 Ko de CSS et réécriraient le DOM en
// continu ; chaque requête par rôle recalculerait alors les styles (50 à 150 ms l'une). Un simple champ les remplace.
vi.mock('../../src/terminal/Terminal.tsx', () => ({ Terminal: (p: { session: string }) => <textarea aria-label={`terminal ${p.session}`} readOnly /> }));

afterEach(cleanup);

const champ = (c: Omit<ChampReglageVue, 'valeur'> & { valeur?: ChampReglageVue['valeur'] }): ChampReglageVue => ({ ...c, valeur: c.valeur ?? c.defaut });

const VUE: ReglagesVue = {
	avertissements: [],
	enAttente: [],
	champs: [
		champ({ cle: 'contexte.seuilInjection', groupe: 'contexte', libelle: 'Seuil d’injection automatique', explication: 'Note minimale d’une injection automatique.', genre: 'entier', defaut: 90, min: 50, max: 100, unite: '%', effet: 'immediat' }),
		champ({ cle: 'contexte.injectionsParMessage', groupe: 'contexte', libelle: 'Fiches injectées automatiquement par message', explication: 'Fiches injectées au plus.', genre: 'entier', defaut: 2, valeur: 3, min: 0, max: 5, unite: 'fiches', effet: 'immediat' }),
		champ({ cle: 'contexte.seuilPiste', groupe: 'contexte', libelle: 'Seuil des pistes', explication: 'Note minimale d’une piste.', genre: 'entier', defaut: 10, min: 0, max: 100, unite: '%', effet: 'immediat' }),
		champ({ cle: 'contexte.similariteRecherche', groupe: 'contexte', libelle: 'Similarité minimale (recherche)', explication: 'Proximité minimale de 0 à 1.', genre: 'decimal', defaut: 0.45, min: 0.1, max: 0.95, effet: 'immediat' }),
		champ({ cle: 'contexte.budgetMessage', groupe: 'contexte', libelle: 'Budget par message', explication: 'Un réglage que l’écran ne connaît pas.', genre: 'entier', defaut: 3000, min: 500, max: 20000, effet: 'immediat' }),
		champ({ cle: 'memoire.fiabilite_email', groupe: 'memoire', libelle: 'Fiabilité : Email', explication: 'Fiabilité d’une information de source « email ».', genre: 'decimal', defaut: 0.7, min: 0, max: 1, effet: 'immediat' }),
		champ({ cle: 'memoire.repetitions', groupe: 'memoire', libelle: 'Répétitions pour monter une consigne', explication: 'Fois où une consigne est redite.', genre: 'entier', defaut: 2, min: 1, max: 20, effet: 'immediat' }),
		champ({
			cle: 'archiviste.typesAConfirmer',
			groupe: 'archiviste',
			libelle: 'Types de fiche à confirmer',
			explication: 'Une information proposée dans ces fiches attend ta confirmation.',
			genre: 'choix-multiple',
			defaut: [],
			choix: [
				{ valeur: 'sujet', libelle: 'Sujet' },
				{ valeur: 'entite', libelle: 'Entité' },
			],
			effet: 'immediat',
		}),
		champ({ cle: 'projets.marqueurs', groupe: 'projets', libelle: 'Marqueurs de projet', explication: 'Un dossier qui contient l’un de ces noms est un projet.', genre: 'liste', defaut: ['.git', 'package.json'], effet: 'immediat' }),
		champ({ cle: 'modeles.inactiviteMinutes', groupe: 'modeles', libelle: 'Arrêt pour inactivité', explication: 'Arrêt des modèles sans requête.', genre: 'entier', defaut: 15, min: 1, max: 240, unite: 'minutes', effet: 'modeles' }),
		champ({ cle: 'service.port', groupe: 'service', libelle: 'Port du service', explication: 'Port local de l’interface.', genre: 'entier', defaut: 4747, min: 1024, max: 65535, effet: 'service' }),
		champ({
			cle: 'service.navigateur',
			groupe: 'service',
			libelle: 'Navigateur du lanceur',
			explication: 'Navigateur qui ouvre la fenêtre de Mnemo.',
			genre: 'choix',
			defaut: 'auto',
			choix: [
				{ valeur: 'auto', libelle: 'Automatique' },
				{ valeur: 'brave', libelle: 'Brave' },
			],
			effet: 'immediat',
		}),
	],
};

const REPONSES = {
	'/api/sessions': { sessions: [] },
	'/api/sante': { ok: true, pid: 1, racine: '~/Dossier', racineAbsolue: '/tmp/Dossier', terminaux: { ok: true }, version: '0.1.0' },
	'/api/fil': { commits: [], aConfirmer: [], montees: [], modifications: [] },
	'/api/memoire/graphe': { coffre: '_mnemo', fiches: [], liens: [], notions: [], sens: { disponible: false, etat: 'absent' }, modifieeMs: 0 },
	'/api/memoire/documents': { documents: [], aTraiter: [], totalDocuments: 0, totalATraiter: 0 },
	'/api/moteurs': { moteurs: [] },
	'/api/claude-desktop': { installee: false, fichier: '~/claude_desktop_config.json', mnemo: 'absent', serveurs: [] },
	'/api/reglages': VUE,
};

/** Le PUT des réglages : la vue avec les valeurs reçues (null : le défaut). */
const enregistrerVue = (_p: unknown, corps: { valeurs: Record<string, unknown> }): ReglagesVue => ({
	...VUE,
	enAttente: 'service.port' in corps.valeurs ? ['service.port'] : [],
	champs: VUE.champs.map((c) => (c.cle in corps.valeurs ? { ...c, valeur: (corps.valeurs[c.cle] ?? c.defaut) as ChampReglageVue['valeur'] } : c)),
});

/** Réglages ouverts sur l'onglet Réglages ; `section` ouvre une section du panneau et rend le contenu de l'onglet. */
async function ouvrirReglages(reponses: Record<string, unknown> = {}) {
	const faux = creerFauxClient({ ...REPONSES, ...reponses });
	render(<Application client={faux.client} />);
	const nav = screen.getByRole('navigation');
	await act(async () => within(nav).getByRole('button', { name: /Réglages/ }).click());
	await act(async () => screen.getByRole('tab', { name: 'Réglages' }).click());
	const panneau = screen.getByRole('tabpanel');
	const section = async (titre: string): Promise<HTMLElement> => {
		await act(async () => within(within(panneau).getByRole('navigation', { name: 'Sections des réglages' })).getByRole('button', { name: new RegExp(`^${titre}`, 'u') }).click());
		await within(panneau).findAllByRole('slider');
		return panneau;
	};
	return { faux, nav, panneau, section };
}

const curseur = (page: HTMLElement, nom: string) => within(page).getByRole('slider', { name: nom }) as HTMLInputElement;
const glisser = (element: HTMLElement, valeur: string) => act(async () => fireEvent.change(element, { target: { value: valeur } }));
/** Le bloc d'un curseur ou d'une barre : le parent de son libellé. */
const blocDe = (page: HTMLElement, nom: string): HTMLElement => curseur(page, nom).closest('div')!;

describe('rail : Réglages en bas', () => {
	it('la roue dentée est la dernière entrée du rail, poussée en bas, avec son raccourci', () => {
		const faux = creerFauxClient(REPONSES);
		render(<Application client={faux.client} />);
		const nav = screen.getByRole('navigation');
		const boutons = within(nav).getAllByRole('button');
		expect(boutons.map((b) => b.textContent?.replace(/\d+$/u, ''))).toEqual(['Sessions', 'Mémoire', 'Réglages']);
		const reglages = boutons[2]!;
		expect(reglages.querySelector('svg')).toBeTruthy();
		expect(reglages.getAttribute('aria-keyshortcuts')).toBe('Alt+Comma');
		expect(reglages.classList.contains('bas')).toBe(true);
		const css = readFileSync(join(import.meta.dirname, '../../src/composants/Navigation.module.css'), 'utf8');
		expect(css).toMatch(/\.bas\s*\{[^}]*margin-top:\s*auto/u);
	});

	it('⌥, ouvre les Réglages', async () => {
		const faux = creerFauxClient(REPONSES);
		render(<Application client={faux.client} />);
		const nav = screen.getByRole('navigation');
		await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Comma', key: ',', metaKey: true })));
		expect(within(nav).getByRole('button', { name: /Réglages/ }).getAttribute('aria-current')).toBeNull();
		await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Comma', key: '≤', altKey: true })));
		expect(within(nav).getByRole('button', { name: /Réglages/ }).getAttribute('aria-current')).toBe('page');
		expect(await screen.findByRole('region', { name: 'Réglages' })).toBeTruthy();
	});
});

describe('vue Réglages', () => {
	it('trois onglets (Agents, Réglages, Documentation), retenus ; le panneau de l’onglet Réglages : Branchements, Mémoire, Système', async () => {
		const valeurs = stockage();
		valeurs.set('mnemo.reglages.onglet', 'systeme');
		const faux = creerFauxClient(REPONSES);
		render(<Application client={faux.client} />);
		await act(async () => within(screen.getByRole('navigation')).getByRole('button', { name: /Réglages/ }).click());
		// une valeur retenue avant la 1.9 mène à l'onglet qui a repris son contenu
		expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Agents', 'Réglages', 'Documentation']);
		expect(screen.getByRole('tab', { name: 'Réglages' }).getAttribute('aria-selected')).toBe('true');
		const sections = within(screen.getByRole('tabpanel')).getByRole('navigation', { name: 'Sections des réglages' });
		expect(within(sections).getAllByRole('button').map((b) => b.textContent)).toEqual(['Branchementsmoteurs et app Claude', 'Mémoirerappel et confiance', 'Systèmeservice, modèles, couleur']);
		await act(async () => screen.getByRole('tab', { name: 'Documentation' }).click());
		expect(valeurs.get('mnemo.reglages.onglet')).toBe('documentation');
		expect(screen.getByRole('region', { name: 'Documentation' })).toBeTruthy();
		vi.unstubAllGlobals();
	});

	it('Mémoire : cartes Rappel et Confiance ; curseur avec sa valeur et sa phrase d’effet, « Défaut · Rétablir » seulement s’il diffère', async () => {
		const { section } = await ouvrirReglages();
		const page = await section('Mémoire');
		expect(within(page).getByRole('heading', { name: 'Rappel' })).toBeTruthy();
		expect(within(page).getByRole('heading', { name: 'Confiance' })).toBeTruthy();
		const injectees = blocDe(page, 'Fiches injectées');
		expect(curseur(page, 'Fiches injectées').value).toBe('3');
		expect(within(injectees).getByText('3 fiches')).toBeTruthy();
		expect(within(injectees).getByText('Jusqu’à 3 fiches par message.')).toBeTruthy();
		expect(within(injectees).getByText(/Défaut : 2 fiches/u)).toBeTruthy();
		expect(curseur(page, 'Fiches injectées').getAttribute('aria-valuetext')).toBe('3 fiches');
		// au défaut : pas de ligne « Défaut »
		const seuil = blocDe(page, 'Seuil d’injection');
		expect(within(seuil).queryByText(/Défaut/u)).toBeNull();
		expect(within(seuil).getByText('Les fiches très sûres entrent seules.')).toBeTruthy();
		await glisser(curseur(page, 'Seuil d’injection'), '100');
		expect(within(seuil).getByText('Jamais d’injection automatique.')).toBeTruthy();
		expect(within(seuil).getByText('100 %')).toBeTruthy();
		expect(within(seuil).getByText(/Défaut : 90 %/u)).toBeTruthy();
		// Rétablir : la valeur du défaut, la ligne disparaît
		await act(async () => within(injectees).getByRole('button', { name: /Rétablir/u }).click());
		expect(curseur(page, 'Fiches injectées').value).toBe('2');
		expect(within(injectees).queryByText(/Défaut/u)).toBeNull();
		// les pistes au-dessus du seuil d'injection : dit avant l'enregistrement
		await glisser(curseur(page, 'Seuil d’injection'), '60');
		await glisser(curseur(page, 'Seuil des pistes'), '80');
		expect(within(blocDe(page, 'Seuil des pistes')).getByText('Au-dessus du seuil d’injection (60 %) : refusé à l’enregistrement.')).toBeTruthy();
	});

	it('Réglages fins repliés avec leur nombre ; un réglage que l’écran ne connaît pas y est, sous son libellé du service', async () => {
		const { section } = await ouvrirReglages();
		const page = await section('Mémoire');
		const fins = within(page).getByText('Réglages fins · 2').closest('details')!;
		expect(fins.open).toBe(false);
		expect((within(fins).getByRole('slider', { name: 'Similarité min.' }) as HTMLInputElement).value).toBe('0.45');
		expect(within(fins).getByRole('slider', { name: 'Budget par message' })).toBeTruthy();
	});

	it('enregistrement : Mémoire et Système ensemble, seules les modifications partent (défaut : null)', async () => {
		const { faux, section } = await ouvrirReglages({ 'PUT /api/reglages': enregistrerVue });
		const page = await section('Mémoire');
		await act(async () => within(blocDe(page, 'Fiches injectées')).getByRole('button', { name: /Rétablir/u }).click());
		// barre décimale : la valeur à deux décimales, à la virgule
		await glisser(curseur(page, 'E-mail'), '0.55');
		expect(within(blocDe(page, 'E-mail')).getByText('0,55')).toBeTruthy();
		await glisser(curseur(page, 'Redites avant de proposer une consigne'), '3');
		expect(within(blocDe(page, 'Redites avant de proposer une consigne')).getByText('3×')).toBeTruthy();
		// « L'archiviste écrit seul » : éteindre un type le met parmi ceux à confirmer
		const archiviste = within(page).getByRole('group', { name: 'Types de fiche' });
		expect(within(archiviste).getAllByRole('switch').map((x) => x.getAttribute('aria-checked'))).toEqual(['true', 'true']);
		await act(async () => within(archiviste).getByRole('switch', { name: 'Entité' }).click());
		// le défaut dit par les interrupteurs : tous allumés (aucun type à confirmer)
		expect(within(archiviste).getByText(/Défaut : tous/u)).toBeTruthy();
		// marqueurs en puces : retirer, ajouter (un doublon n'est pas ajouté)
		const marqueurs = within(page).getByRole('list', { name: 'Marqueurs de projet' });
		await act(async () => within(marqueurs).getByRole('button', { name: 'Retirer package.json' }).click());
		for (const nom of ['Makefile', '.GIT']) {
			await act(async () => within(marqueurs).getByRole('button', { name: '+ ajouter' }).click());
			const saisie = within(marqueurs).getByRole('textbox');
			await act(async () => fireEvent.change(saisie, { target: { value: ` ${nom} ` } }));
			await act(async () => fireEvent.keyDown(saisie, { key: 'Enter' }));
		}
		expect(within(marqueurs).getAllByRole('listitem').map((x) => x.textContent)).toEqual(['.git×', 'Makefile×', '+ ajouter']);
		// la saisie de Mémoire est gardée quand on ouvre Système
		await section('Système');
		expect(within(within(page).getByRole('navigation', { name: 'Sections des réglages' })).getByRole('button', { name: /^Mémoire/u }).textContent).toContain('modifié');
		await act(async () => {
			fireEvent.change(within(page).getByRole('spinbutton', { name: 'Port' }), { target: { value: '4800' } });
			fireEvent.change(within(page).getByRole('combobox', { name: 'S’ouvre dans' }), { target: { value: 'brave' } });
		});
		expect(within(page).getByText('Modifié, non enregistré')).toBeTruthy();
		await act(async () => within(page).getByRole('button', { name: 'Enregistrer' }).click());
		expect(faux.api.remplacer).toHaveBeenCalledWith('/api/reglages', {
			valeurs: {
				'contexte.injectionsParMessage': null,
				'memoire.fiabilite_email': 0.55,
				'memoire.repetitions': 3,
				'archiviste.typesAConfirmer': ['entite'],
				'projets.marqueurs': ['.git', 'Makefile'],
				'service.port': 4800,
				'service.navigateur': 'brave',
			},
		});
		// deux annonces : le redémarrage en attente, et « Enregistré. »
		const annonces = async () => (await within(page).findAllByRole('status')).map((x) => x.textContent ?? '');
		expect(await annonces()).toContainEqual(expect.stringMatching(/Redémarrage du service requis.*Port du service.*mnemo arreter/u));
		expect(await annonces()).toContain('Enregistré.');
		expect(within(page).getByText(/port 4800 au prochain démarrage/u)).toBeTruthy();
		expect(within(page).getByRole('button', { name: 'Enregistrer' }).hasAttribute('disabled')).toBe(true);
	});

	it('Système : l’état du service ; ce qui ne vaut qu’au redémarrage est signalé ; port fixé par MNEMO_PORT', async () => {
		const { section } = await ouvrirReglages({ '/api/reglages': { ...VUE, champs: VUE.champs.map((c) => (c.cle === 'service.port' ? { ...c, fixePar: 'MNEMO_PORT' } : c)) } });
		const page = await section('Système');
		expect(within(page).getByText('En marche')).toBeTruthy();
		expect(within(page).getByText('version 0.1.0 · port 4747')).toBeTruthy();
		expect(within(page).getByText('Fixé par MNEMO_PORT')).toBeTruthy();
		expect(within(page).queryByText('Redémarrage du service requis')).toBeNull();
		const modeles = blocDe(page, 'S’endorment après');
		expect(within(modeles).getByText('Au prochain démarrage des modèles')).toBeTruthy();
		expect(within(modeles).getByText('15 minutes')).toBeTruthy();
		expect(within(modeles).getByText('Un bon équilibre.')).toBeTruthy();
	});

	it('refus du service : le motif est affiché, le brouillon gardé', async () => {
		const { section } = await ouvrirReglages({
			'PUT /api/reglages': () => {
				throw new ErreurApi('Réglages refusés : Port du service (service.port) : entier de 1024 à 65535 attendu.', 400);
			},
		});
		const page = await section('Système');
		await act(async () => fireEvent.change(within(page).getByRole('spinbutton', { name: 'Port' }), { target: { value: '80' } }));
		await act(async () => within(page).getByRole('button', { name: 'Enregistrer' }).click());
		expect((await within(page).findByRole('alert')).textContent).toContain('entier de 1024 à 65535');
		expect((within(page).getByRole('spinbutton', { name: 'Port' }) as HTMLInputElement).value).toBe('80');
	});

	it('Enregistrer désactivé tant que rien n’est modifié, et visiblement ; pas de pied sur Branchements', async () => {
		const { panneau, section } = await ouvrirReglages();
		expect(within(panneau).queryByRole('button', { name: 'Enregistrer' })).toBeNull();
		const page = await section('Mémoire');
		expect(within(page).getByRole('button', { name: 'Enregistrer' }).hasAttribute('disabled')).toBe(true);
		expect(within(page).getByRole('button', { name: 'Annuler' }).hasAttribute('disabled')).toBe(true);
		const css = readFileSync(join(import.meta.dirname, '../../src/composants/commun/Bouton.module.css'), 'utf8');
		expect(css).toMatch(/\.primaire:disabled\s*\{[^}]*background:\s*var\(--s3\)/u);
	});

	it('Annuler : la saisie repart de ce qui est enregistré', async () => {
		const { section } = await ouvrirReglages();
		const page = await section('Mémoire');
		await glisser(curseur(page, 'Seuil d’injection'), '70');
		await act(async () => within(page).getByRole('button', { name: 'Annuler' }).click());
		expect(curseur(page, 'Seuil d’injection').value).toBe('90');
		expect(within(page).queryByText('Modifié, non enregistré')).toBeNull();
	});

	it('changer d’onglet avec une saisie non enregistrée : retenu ; Rester garde la saisie', async () => {
		const { section } = await ouvrirReglages();
		const page = await section('Mémoire');
		await glisser(curseur(page, 'Seuil d’injection'), '70');
		await act(async () => screen.getByRole('tab', { name: 'Agents' }).click());
		const retenu = screen.getAllByRole('alert').find((a) => a.textContent?.includes('dans cet onglet'))!;
		await act(async () => within(retenu).getByRole('button', { name: 'Rester' }).click());
		expect(screen.getByRole('tab', { name: 'Réglages' }).getAttribute('aria-selected')).toBe('true');
		expect(curseur(page, 'Seuil d’injection').value).toBe('70');
	});

	it('quitter avec des modifications non enregistrées : avertissement dans la page ; Rester, Abandonner, Enregistrer', async () => {
		const { faux, nav, section } = await ouvrirReglages({ 'PUT /api/reglages': enregistrerVue });
		const reglages = () => within(nav).getByRole('button', { name: /Réglages/ });
		const sessions = () => within(nav).getByRole('button', { name: /Sessions/ });
		// une modification, puis un clic sur Sessions : la vue reste, l'avertissement s'affiche
		const page = await section('Système');
		await act(async () => fireEvent.change(within(page).getByRole('spinbutton', { name: 'Port' }), { target: { value: '4800' } }));
		await act(async () => sessions().click());
		expect(reglages().getAttribute('aria-current')).toBe('page');
		const alerte = within(page).getByRole('alert');
		expect(alerte.textContent).toMatch(/Modifications non enregistrées/u);
		await act(async () => within(alerte).getByRole('button', { name: 'Rester' }).click());
		expect(within(page).queryByRole('alert')).toBeNull();
		expect((within(page).getByRole('spinbutton', { name: 'Port' }) as HTMLInputElement).value).toBe('4800');
		// Enregistrer depuis l'avertissement : enregistre, puis part
		await act(async () => sessions().click());
		await act(async () => within(within(page).getByRole('alert')).getByRole('button', { name: 'Enregistrer' }).click());
		expect(faux.api.remplacer).toHaveBeenCalledWith('/api/reglages', { valeurs: { 'service.port': 4800 } });
		expect(sessions().getAttribute('aria-current')).toBe('page');
		// Abandonner : part sans enregistrer
		await act(async () => reglages().click());
		await act(async () => screen.getByRole('tab', { name: 'Réglages' }).click());
		const panneau2 = screen.getByRole('tabpanel');
		await act(async () => within(within(panneau2).getByRole('navigation', { name: 'Sections des réglages' })).getByRole('button', { name: /^Mémoire/u }).click());
		await glisser(await within(panneau2).findByRole('slider', { name: 'Seuil d’injection' }), '70');
		await act(async () => sessions().click());
		await act(async () => within(within(panneau2).getByRole('alert')).getByRole('button', { name: 'Abandonner' }).click());
		expect(sessions().getAttribute('aria-current')).toBe('page');
		expect(faux.api.remplacer).toHaveBeenCalledTimes(1);
	});

	it('quitter avec des réglages et un serveur MCP en saisie : un seul avertissement nomme les deux ; « Enregistrer les réglages » laisse le serveur à enregistrer', async () => {
		const { faux, nav, panneau, section } = await ouvrirReglages({
			'PUT /api/reglages': enregistrerVue,
			'/api/claude-desktop': { installee: true, fichier: '~/claude_desktop_config.json', mnemo: 'absent', serveurs: [] },
		});
		const sessions = () => within(nav).getByRole('button', { name: /Sessions/ });
		const page = await section('Mémoire');
		await glisser(curseur(page, 'Seuil d’injection'), '70');
		await act(async () => within(within(panneau).getByRole('navigation', { name: 'Sections des réglages' })).getByRole('button', { name: /^Branchements/u }).click());
		await act(async () => within(panneau).getByRole('button', { name: '+ Ajouter un serveur' }).click());
		const formulaire = within(panneau).getByRole('form', { name: 'Ajouter un serveur MCP' });
		await act(async () => fireEvent.change(within(formulaire).getByLabelText('Nom'), { target: { value: 'outil' } }));
		// depuis Mémoire : la sortie retenue montre Branchements, un seul avertissement
		await act(async () => within(within(panneau).getByRole('navigation', { name: 'Sections des réglages' })).getByRole('button', { name: /^Mémoire/u }).click());
		await act(async () => sessions().click());
		expect(within(within(panneau).getByRole('navigation', { name: 'Sections des réglages' })).getByRole('button', { name: /^Branchements/u }).getAttribute('aria-current')).toBe('true');
		const alertes = within(panneau).getAllByRole('alert');
		expect(alertes).toHaveLength(1);
		expect(alertes[0]!.textContent).toMatch(/Deux saisies non enregistrées : des réglages.*et un serveur MCP/u);
		await act(async () => within(alertes[0]!).getByRole('button', { name: 'Enregistrer les réglages' }).click());
		expect(faux.api.remplacer).toHaveBeenCalledWith('/api/reglages', { valeurs: { 'contexte.seuilInjection': 70 } });
		// les réglages enregistrés, la sortie reste retenue : le formulaire propose maintenant le serveur
		expect(within(nav).getByRole('button', { name: /Réglages/ }).getAttribute('aria-current')).toBe('page');
		const restante = within(formulaire).getByRole('alert');
		expect(restante.textContent).toContain('Serveur MCP non enregistré');
		expect((within(formulaire).getByLabelText('Nom') as HTMLInputElement).value).toBe('outil');
		await act(async () => within(restante).getByRole('button', { name: 'Abandonner' }).click());
		expect(sessions().getAttribute('aria-current')).toBe('page');
	});

	it('« Tout abandonner » : part sans rien enregistrer', async () => {
		const { faux, nav, panneau, section } = await ouvrirReglages({
			'/api/claude-desktop': { installee: true, fichier: '~/claude_desktop_config.json', mnemo: 'absent', serveurs: [] },
		});
		const page = await section('Système');
		await act(async () => fireEvent.change(within(page).getByRole('spinbutton', { name: 'Port' }), { target: { value: '4800' } }));
		await act(async () => within(within(panneau).getByRole('navigation', { name: 'Sections des réglages' })).getByRole('button', { name: /^Branchements/u }).click());
		await act(async () => within(panneau).getByRole('button', { name: '+ Ajouter un serveur' }).click());
		await act(async () => fireEvent.change(within(within(panneau).getByRole('form')).getByLabelText('Nom'), { target: { value: 'outil' } }));
		await act(async () => within(nav).getByRole('button', { name: /Sessions/ }).click());
		await act(async () => within(within(panneau).getByRole('alert')).getByRole('button', { name: 'Tout abandonner' }).click());
		expect(within(nav).getByRole('button', { name: /Sessions/ }).getAttribute('aria-current')).toBe('page');
		expect(faux.api.remplacer).not.toHaveBeenCalled();
		expect(faux.api.envoyer).not.toHaveBeenCalled();
	});

	it('avertissements de lecture du fichier affichés en tête', async () => {
		const { panneau } = await ouvrirReglages({ '/api/reglages': { ...VUE, avertissements: ['.mnemo/reglages.json : Réglage « modeles.inactiviteMinutes » invalide ; défaut : 15.'] } });
		expect(await within(panneau).findByText(/modeles\.inactiviteMinutes.*invalide/u)).toBeTruthy();
	});
});

describe('couleur principale', () => {
	const ACCENT = champ({ cle: 'interface.accent', groupe: 'interface', libelle: 'Couleur principale de l’interface', explication: 'Couleur des éléments actifs.', genre: 'couleur', defaut: '#7df0c6', valeur: '#ff8800', effet: 'immediat' });
	const vue = { avertissements: [], enAttente: [], champs: [ACCENT] };
	const racine = () => document.documentElement.style;

	afterEach(() => {
		for (const j of ['--ac', '--sur-accent', '--bg', '--violet']) racine().removeProperty(j);
	});

	/** Réglages › Système ouvert ; rend le nuancier. */
	async function ouvrirCouleur(reponses: Record<string, unknown>): Promise<{ faux: ReturnType<typeof creerFauxClient>; nuancier: HTMLElement }> {
		const faux = creerFauxClient({ ...REPONSES, '/api/reglages': vue, ...reponses });
		render(<Application client={faux.client} />);
		await act(async () => within(screen.getByRole('navigation')).getByRole('button', { name: /Réglages/ }).click());
		await act(async () => screen.getByRole('tab', { name: 'Réglages' }).click());
		await act(async () => within(screen.getByRole('navigation', { name: 'Sections des réglages' })).getByRole('button', { name: /^Système/u }).click());
		return { faux, nuancier: await screen.findByRole('group', { name: 'Couleur de l’interface' }) };
	}

	it('posée sur --ac au chargement, d’après le réglage', async () => {
		const faux = creerFauxClient({ ...REPONSES, '/api/reglages': vue });
		render(<Application client={faux.client} />);
		await waitFor(() => expect(racine().getPropertyValue('--ac')).toBe('#ff8800'));
	});

	it('pastilles : le vert d’origine et les couleurs des agents lues dans les jetons ; une couleur à la main dans « Autre couleur »', async () => {
		racine().setProperty('--violet', '#a394ff');
		const { faux, nuancier } = await ouvrirCouleur({ 'PUT /api/reglages': { ...vue, champs: [{ ...ACCENT, valeur: '#a394ff' }] } });
		// les jetons absents (ici, tous sauf --violet) ne donnent pas de pastille
		expect(within(nuancier).getAllByRole('button').map((x) => [x.getAttribute('aria-label'), x.getAttribute('aria-pressed')])).toEqual([
			['Vert d’origine', 'false'],
			['Violet', 'false'],
		]);
		expect((within(nuancier).getByLabelText('Autre couleur') as HTMLInputElement).value).toBe('#ff8800');
		await act(async () => within(nuancier).getByRole('button', { name: 'Violet' }).click());
		expect(racine().getPropertyValue('--ac')).toBe('#a394ff');
		expect(within(nuancier).getByRole('button', { name: 'Violet' }).getAttribute('aria-pressed')).toBe('true');
		await act(async () => screen.getByRole('button', { name: 'Enregistrer' }).click());
		expect(faux.api.remplacer).toHaveBeenCalledWith('/api/reglages', { valeurs: { 'interface.accent': '#a394ff' } });
	});

	it('autre couleur : appliquée tout de suite, texte clair sur un accent foncé ; « Rétablir » rend le vert d’origine', async () => {
		const { nuancier } = await ouvrirCouleur({});
		await act(async () => fireEvent.change(within(nuancier).getByLabelText('Autre couleur'), { target: { value: '#1d3557' } }));
		expect(racine().getPropertyValue('--ac')).toBe('#1d3557');
		expect(racine().getPropertyValue('--sur-accent')).toBe('var(--sur-accent-clair)');
		await act(async () => screen.getByRole('button', { name: /Rétablir/u }).click());
		expect(within(nuancier).getByRole('button', { name: 'Vert d’origine' }).getAttribute('aria-pressed')).toBe('true');
		expect(racine().getPropertyValue('--ac')).toBe('#7df0c6');
	});

	it('avertit sous le nuancier quand la couleur se lit mal sur le fond (contraste sous 3:1), pas autrement', async () => {
		racine().setProperty('--bg', '#09090b');
		const { nuancier } = await ouvrirCouleur({});
		const bloc = nuancier.parentElement!;
		expect(within(bloc).queryByRole('status')).toBeNull();
		await act(async () => fireEvent.change(within(nuancier).getByLabelText('Autre couleur'), { target: { value: '#1d3557' } }));
		expect(within(bloc).getByRole('status').textContent).toMatch(/se lit mal sur le fond/);
		await act(async () => fireEvent.change(within(nuancier).getByLabelText('Autre couleur'), { target: { value: '#ffd23f' } }));
		expect(within(bloc).queryByRole('status')).toBeNull();
	});
});
