// @vitest-environment happy-dom
import type { ChampReglageVue, ReglagesVue } from '@mnemo/contrat';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ErreurApi } from '../../src/client/api.ts';
import { Application } from '../../src/composants/Application.tsx';
import { creerFauxClient } from '../aides/faux-client.tsx';

afterEach(cleanup);

const champ = (c: Omit<ChampReglageVue, 'valeur'> & { valeur?: ChampReglageVue['valeur'] }): ChampReglageVue => ({ ...c, valeur: c.valeur ?? c.defaut });

const VUE: ReglagesVue = {
	avertissements: [],
	enAttente: [],
	champs: [
		champ({ cle: 'projets.marqueurs', groupe: 'projets', libelle: 'Marqueurs de projet', explication: 'Un dossier qui contient l’un de ces noms est un projet.', genre: 'liste', defaut: ['.git', 'package.json'], effet: 'immediat' }),
		champ({ cle: 'contexte.budgetMessage', groupe: 'contexte', libelle: 'Budget par message', explication: 'Taille maximale servie à chaque message.', genre: 'entier', defaut: 3000, valeur: 5000, min: 500, max: 20000, unite: 'caractères', effet: 'immediat' }),
		champ({ cle: 'contexte.similariteHooks', groupe: 'contexte', libelle: 'Similarité minimale', explication: 'Proximité minimale de 0 à 1.', genre: 'decimal', defaut: 0.55, min: 0.1, max: 0.95, effet: 'immediat' }),
		champ({ cle: 'modeles.inactiviteMinutes', groupe: 'modeles', libelle: 'Arrêt pour inactivité', explication: 'Arrêt des modèles sans requête.', genre: 'entier', defaut: 15, min: 1, max: 240, unite: 'minutes', effet: 'modeles' }),
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
	'/api/reglages': VUE,
};

async function ouvrirReglages(reponses: Record<string, unknown> = {}) {
	const faux = creerFauxClient({ ...REPONSES, ...reponses });
	render(<Application client={faux.client} />);
	const nav = screen.getByRole('navigation');
	await act(async () => within(nav).getByRole('button', { name: /Réglages/ }).click());
	const page = await ouvrirSysteme();
	return { faux, nav, page, groupe: (titre: string) => choisirGroupe(page, titre) };
}

/** Onglet Système des Réglages (l'onglet Profils s'ouvre d'abord) : son formulaire, une fois les réglages lus. */
async function ouvrirSysteme(): Promise<HTMLElement> {
	await act(async () => screen.getByRole('tab', { name: 'Système' }).click());
	return screen.findByRole('form', { name: 'Réglages système' });
}

/** L'onglet Système montre un groupe à la fois (le premier d'abord) : choisit celui dont le titre est donné. */
async function choisirGroupe(page: HTMLElement, titre: string): Promise<void> {
	const groupes = within(page).getByRole('navigation', { name: 'Groupes de réglages' });
	await act(async () => within(groupes).getByRole('button', { name: new RegExp(`^${titre}`, 'u') }).click());
}

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
	it('groupée par thème, chaque champ avec son explication et son défaut ; ce qui demande un redémarrage est signalé', async () => {
		const { page, groupe } = await ouvrirReglages();
		// les groupes à gauche, dans l'ordre de GROUPES_REGLAGES ; le premier est ouvert
		const groupes = within(page).getByRole('navigation', { name: 'Groupes de réglages' });
		expect(within(groupes).getAllByRole('button').map((b) => b.textContent?.replace(/\d+ réglage\(s\)$/u, ''))).toEqual(['Contexte injecté', 'Archiviste', 'Projets', 'Modèles', 'Service', 'MoteursLiaison à Mnemo sur ce poste']);
		expect(within(page).getByRole('group', { name: 'Contexte injecté' })).toBeTruthy();
		expect(within(page).getByText('Taille maximale servie à chaque message.')).toBeTruthy();
		expect(within(page).getByText('Défaut : 3000 caractères')).toBeTruthy();
		expect(within(within(page).getByRole('group', { name: 'Budget par message' })).queryByText(/redémarrage/iu)).toBeNull();
		expect((within(page).getByRole('spinbutton', { name: 'Budget par message' }) as HTMLInputElement).value).toBe('5000');
		await groupe('Service');
		expect(within(page).getByText('Défaut : 4747')).toBeTruthy();
		expect(within(page).getByText('Défaut : Automatique')).toBeTruthy();
		const port = within(page).getByRole('group', { name: 'Port du service' });
		expect(within(port).getByText('Redémarrage du service requis')).toBeTruthy();
		await groupe('Modèles');
		const modeles = within(page).getByRole('group', { name: 'Arrêt pour inactivité' });
		expect(within(modeles).getByText('Au prochain démarrage des modèles')).toBeTruthy();
		await groupe('Archiviste');
		expect(within(page).getByText('Défaut : aucun')).toBeTruthy();
		await groupe('Projets');
		expect((within(page).getByRole('textbox', { name: 'Marqueurs de projet' }) as HTMLInputElement).value).toBe('.git, package.json');
		expect(within(page).getByRole('button', { name: 'Enregistrer' }).hasAttribute('disabled')).toBe(true);
	});

	it('« Rétablir le défaut » par champ, puis enregistrement explicite : seules les modifications partent (défaut : null)', async () => {
		const { faux, page, groupe } = await ouvrirReglages({
			'PUT /api/reglages': (_p: unknown, corps: { valeurs: Record<string, unknown> }) => ({
				...VUE,
				enAttente: 'service.port' in corps.valeurs ? ['service.port'] : [],
				champs: VUE.champs.map((c) => (c.cle in corps.valeurs ? { ...c, valeur: (corps.valeurs[c.cle] ?? c.defaut) as ChampReglageVue['valeur'] } : c)),
			}),
		});
		const budget = within(page).getByRole('group', { name: 'Budget par message' });
		await act(async () => within(budget).getByRole('button', { name: 'Rétablir le défaut' }).click());
		expect((within(budget).getByRole('spinbutton') as HTMLInputElement).value).toBe('3000');
		// la saisie d'un groupe est gardée quand on en ouvre un autre
		await groupe('Service');
		// le port est à son défaut : rien à rétablir
		expect(within(within(page).getByRole('group', { name: 'Port du service' })).getByRole('button', { name: 'Rétablir le défaut' }).hasAttribute('disabled')).toBe(true);
		await act(async () => {
			fireEvent.change(within(page).getByRole('spinbutton', { name: 'Port du service' }), { target: { value: '4800' } });
			fireEvent.change(within(page).getByRole('combobox', { name: 'Navigateur du lanceur' }), { target: { value: 'brave' } });
		});
		await groupe('Projets');
		await act(async () => fireEvent.change(within(page).getByRole('textbox', { name: 'Marqueurs de projet' }), { target: { value: '.git, Makefile ,' } }));
		await groupe('Archiviste');
		await act(async () => fireEvent.click(within(page).getByRole('checkbox', { name: 'Entité' })));
		const enregistrer = within(page).getByRole('button', { name: 'Enregistrer' });
		expect(enregistrer.hasAttribute('disabled')).toBe(false);
		await act(async () => enregistrer.click());
		expect(faux.api.remplacer).toHaveBeenCalledWith('/api/reglages', {
			valeurs: { 'projets.marqueurs': ['.git', 'Makefile'], 'contexte.budgetMessage': null, 'archiviste.typesAConfirmer': ['entite'], 'service.port': 4800, 'service.navigateur': 'brave' },
		});
		// deux annonces : le redémarrage en attente, et « Enregistré. »
		const annonces = async () => (await within(page).findAllByRole('status')).map((x) => x.textContent ?? '');
		expect(await annonces()).toContainEqual(expect.stringMatching(/Redémarrage du service requis.*Port du service.*mnemo arreter/u));
		expect(await annonces()).toContain('Enregistré.');
		expect(within(page).getByRole('button', { name: 'Enregistrer' }).hasAttribute('disabled')).toBe(true);
	});

	it('refus du service : le motif est affiché, le brouillon gardé', async () => {
		const { page, groupe } = await ouvrirReglages({
			'PUT /api/reglages': () => {
				throw new ErreurApi('Réglages refusés : Port du service (service.port) : entier de 1024 à 65535 attendu.', 400);
			},
		});
		await groupe('Service');
		await act(async () => fireEvent.change(within(page).getByRole('spinbutton', { name: 'Port du service' }), { target: { value: '80' } }));
		await act(async () => within(page).getByRole('button', { name: 'Enregistrer' }).click());
		expect((await within(page).findByRole('alert')).textContent).toContain('entier de 1024 à 65535');
		expect((within(page).getByRole('spinbutton', { name: 'Port du service' }) as HTMLInputElement).value).toBe('80');
	});

	it('Enregistrer désactivé tant que rien n’est modifié, et visiblement (style propre au bouton primaire désactivé)', async () => {
		const { page } = await ouvrirReglages();
		expect(within(page).getByRole('button', { name: 'Enregistrer' }).hasAttribute('disabled')).toBe(true);
		const css = readFileSync(join(import.meta.dirname, '../../src/composants/commun/Bouton.module.css'), 'utf8');
		expect(css).toMatch(/\.primaire:disabled\s*\{[^}]*background:\s*var\(--s3\)/u);
	});

	it('décimal : champ texte, virgule affichée comme dans « Défaut », point accepté', async () => {
		const { faux, page } = await ouvrirReglages({ 'PUT /api/reglages': () => VUE });
		const champ = within(page).getByRole('textbox', { name: 'Similarité minimale' }) as HTMLInputElement;
		expect(champ.value).toBe('0,55');
		expect(within(page).getByText('Défaut : 0,55')).toBeTruthy();
		await act(async () => fireEvent.change(champ, { target: { value: '0.7' } }));
		await act(async () => within(page).getByRole('button', { name: 'Enregistrer' }).click());
		expect(faux.api.remplacer).toHaveBeenCalledWith('/api/reglages', { valeurs: { 'contexte.similariteHooks': 0.7 } });
	});

	it('oui ou non : une case nommée par le libellé ; décochée, part à false', async () => {
		const automatique = champ({ cle: 'entrainement.automatique', groupe: 'entrainement', libelle: 'Réapprentissage automatique de la note', explication: 'Réapprendre la note en fond.', genre: 'booleen', defaut: true, effet: 'immediat' });
		const vue = { ...VUE, champs: [...VUE.champs, automatique] };
		const { faux, page, groupe } = await ouvrirReglages({ '/api/reglages': vue, 'PUT /api/reglages': () => vue });
		await groupe('Note de confiance');
		const caseACocher = within(page).getByRole('checkbox', { name: 'Réapprentissage automatique de la note' }) as HTMLInputElement;
		expect(caseACocher.checked).toBe(true);
		expect(within(page).getByText('Défaut : oui')).toBeTruthy();
		await act(async () => fireEvent.click(caseACocher));
		await act(async () => within(page).getByRole('button', { name: 'Enregistrer' }).click());
		expect(faux.api.remplacer).toHaveBeenCalledWith('/api/reglages', { valeurs: { 'entrainement.automatique': false } });
	});

	it('port fixé par MNEMO_PORT : dit dans le champ', async () => {
		const { page, groupe } = await ouvrirReglages({ '/api/reglages': { ...VUE, champs: VUE.champs.map((c) => (c.cle === 'service.port' ? { ...c, fixePar: 'MNEMO_PORT' } : c)) } });
		await groupe('Service');
		const port = within(page).getByRole('group', { name: 'Port du service' });
		expect(within(port).getByText('Fixé par MNEMO_PORT')).toBeTruthy();
		expect(within(port).queryByText('Redémarrage du service requis')).toBeNull();
	});

	it('quitter avec des modifications non enregistrées : avertissement dans la page ; Rester, Abandonner, Enregistrer', async () => {
		const { faux, nav, page, groupe } = await ouvrirReglages({ 'PUT /api/reglages': (_p: unknown, corps: { valeurs: Record<string, unknown> }) => ({ ...VUE, champs: VUE.champs.map((c) => (c.cle in corps.valeurs ? { ...c, valeur: corps.valeurs[c.cle] as ChampReglageVue['valeur'] } : c)) }) });
		const reglages = () => within(nav).getByRole('button', { name: /Réglages/ });
		const sessions = () => within(nav).getByRole('button', { name: /Sessions/ });
		// une modification, puis un clic sur Sessions : la vue reste, l'avertissement s'affiche
		await groupe('Service');
		await act(async () => fireEvent.change(within(page).getByRole('spinbutton', { name: 'Port du service' }), { target: { value: '4800' } }));
		await act(async () => sessions().click());
		expect(reglages().getAttribute('aria-current')).toBe('page');
		const alerte = within(page).getByRole('alert');
		expect(alerte.textContent).toMatch(/Modifications non enregistrées/u);
		await act(async () => within(alerte).getByRole('button', { name: 'Rester' }).click());
		expect(within(page).queryByRole('alert')).toBeNull();
		expect((within(page).getByRole('spinbutton', { name: 'Port du service' }) as HTMLInputElement).value).toBe('4800');
		// Enregistrer depuis l'avertissement : enregistre, puis part
		await act(async () => sessions().click());
		await act(async () => within(within(page).getByRole('alert')).getByRole('button', { name: 'Enregistrer' }).click());
		expect(faux.api.remplacer).toHaveBeenCalledWith('/api/reglages', { valeurs: { 'service.port': 4800 } });
		expect(sessions().getAttribute('aria-current')).toBe('page');
		// Abandonner : part sans enregistrer
		await act(async () => reglages().click());
		const page2 = await ouvrirSysteme();
		await act(async () => fireEvent.change(within(page2).getByRole('spinbutton', { name: 'Budget par message' }), { target: { value: '2000' } }));
		await act(async () => sessions().click());
		await act(async () => within(within(page2).getByRole('alert')).getByRole('button', { name: 'Abandonner' }).click());
		expect(sessions().getAttribute('aria-current')).toBe('page');
		expect(faux.api.remplacer).toHaveBeenCalledTimes(1);
	});

	it('avertissements de lecture du fichier affichés en tête', async () => {
		const { page } = await ouvrirReglages({ '/api/reglages': { ...VUE, avertissements: ['.mnemo/reglages.json : Réglage « modeles.inactiviteMinutes » invalide ; défaut : 15.'] } });
		expect(within(page).getByText(/modeles\.inactiviteMinutes.*invalide/u)).toBeTruthy();
	});
});

describe('couleur principale', () => {
	const ACCENT = champ({ cle: 'interface.accent', groupe: 'interface', libelle: 'Couleur principale de l’interface', explication: 'Couleur des éléments actifs.', genre: 'couleur', defaut: '#7df0c6', valeur: '#ff8800', effet: 'immediat' });
	const vue = { avertissements: [], enAttente: [], champs: [ACCENT] };
	const racine = () => document.documentElement.style;

	afterEach(() => {
		racine().removeProperty('--ac');
		racine().removeProperty('--sur-accent');
		racine().removeProperty('--bg');
	});

	it('posée sur --ac au chargement, d’après le réglage', async () => {
		const faux = creerFauxClient({ ...REPONSES, '/api/reglages': vue });
		render(<Application client={faux.client} />);
		await waitFor(() => expect(racine().getPropertyValue('--ac')).toBe('#ff8800'));
	});

	it('changée dans Réglages › Système : appliquée tout de suite, texte clair sur un accent foncé, envoyée à l’enregistrement', async () => {
		const faux = creerFauxClient({ ...REPONSES, '/api/reglages': vue, 'PUT /api/reglages': { ...vue, champs: [{ ...ACCENT, valeur: '#1d3557' }] } });
		render(<Application client={faux.client} />);
		await act(async () => within(screen.getByRole('navigation')).getByRole('button', { name: /Réglages/ }).click());
		await act(async () => screen.getByRole('tab', { name: 'Système' }).click());
		const groupe = await screen.findByRole('group', { name: 'Couleur principale de l’interface' });
		const selecteur = within(groupe).getByDisplayValue('#ff8800');
		expect((selecteur as HTMLInputElement).type).toBe('color');
		await act(async () => {
			fireEvent.change(selecteur, { target: { value: '#1d3557' } });
		});
		expect(racine().getPropertyValue('--ac')).toBe('#1d3557');
		expect(racine().getPropertyValue('--sur-accent')).toBe('var(--sur-accent-clair)');
		await act(async () => screen.getAllByRole('button', { name: 'Enregistrer' })[0]!.click());
		expect(faux.api.remplacer).toHaveBeenCalledWith('/api/reglages', { valeurs: { 'interface.accent': '#1d3557' } });
	});

	it('avertit sous le sélecteur quand la couleur se lit mal sur le fond (contraste sous 3:1), pas autrement', async () => {
		racine().setProperty('--bg', '#09090b');
		const faux = creerFauxClient({ ...REPONSES, '/api/reglages': vue });
		render(<Application client={faux.client} />);
		await act(async () => within(screen.getByRole('navigation')).getByRole('button', { name: /Réglages/ }).click());
		await act(async () => screen.getByRole('tab', { name: 'Système' }).click());
		const groupe = await screen.findByRole('group', { name: 'Couleur principale de l’interface' });
		const selecteur = within(groupe).getByDisplayValue('#ff8800');
		expect(within(groupe).queryByRole('status')).toBeNull();
		await act(async () => {
			fireEvent.change(selecteur, { target: { value: '#1d3557' } });
		});
		expect(within(groupe).getByRole('status').textContent).toMatch(/se lit mal sur le fond/);
		await act(async () => {
			fireEvent.change(selecteur, { target: { value: '#ffd23f' } });
		});
		expect(within(groupe).queryByRole('status')).toBeNull();
		racine().removeProperty('--bg');
	});
});
