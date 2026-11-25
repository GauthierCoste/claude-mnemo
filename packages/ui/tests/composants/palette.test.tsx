// @vitest-environment happy-dom
import type { SessionVue } from '@mnemo/contrat';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DonneesGraphe, FicheGraphe, FicheVue, TrouveRechercheVue } from '@mnemo/contrat';
import { Application } from '../../src/composants/Application.tsx';
import { dossiersFaux } from '../aides/dossiers-faux.ts';
import { creerFauxClient } from '../aides/faux-client.tsx';

vi.mock('../../src/terminal/Terminal.tsx', () => ({
	Terminal: (p: { session: string }) => <textarea className="xterm-helper-textarea" aria-label={`terminal ${p.session}`} readOnly />,
}));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function session(id: string, objectif: string, e: Partial<SessionVue> = {}): SessionVue {
	return { id, profil: 'travail', dossier: 'erp-saas', position: 'projets/erp-saas', projet: 'erp-saas', objectif, etat: 'attend', creeeMs: 1, majMs: 1, bilanDemandeMs: null, commitDebut: null, branche: 'main', terminal: true, dialogueOuvert: false, dossierNonRattache: null, niveauModeles: null, ...e };
}

function fiche(chemin: string, titre: string, alias: string[] = []): FicheGraphe {
	return { chemin, titre, type: 'sujet', alias, etats: [], faitsActifs: 1, categories: {}, dates: [], branche: chemin.split('/').slice(0, -1).join('/'), parent: null };
}

const SESSIONS = [session('s-stocks', 'Refondre le module stocks pour gérer les lots'), session('s-csv', "Corriger l'export CSV"), session('s-fin', 'Relance facture Durand', { etat: 'terminee' })];
const GRAPHE: DonneesGraphe = {
	coffre: '_mnemo',
	fiches: [fiche('projets/erp-saas/Module stocks.md', 'Module stocks'), fiche('projets/erp-saas/Export CSV.md', 'Export CSV'), fiche('personnes/Marc.md', 'Marc Lefèvre', ['responsable des stocks'])],
	liens: [],
	notions: [],
	sens: { disponible: false, etat: 'absent' },
	modifieeMs: 0,
};
const TROUVE: TrouveRechercheVue = {
	id: 'sources/cdc.md#^f-0002',
	chemin: 'sources/cdc.md',
	genre: 'fait',
	texte: 'Sortie de stock en premier périmé, premier sorti.',
	contexte: 'Sources › Cahier des charges',
	typeFiche: 'source',
	statut: 'servi',
	date: null,
	valideFin: null,
	finIncluse: false,
	categorie: null,
	portee: null,
	confiance: null,
	source: null,
	typeSource: null,
	score: 0.8,
	note: null,
};
/** La fiche « Module stocks » telle que le moteur la rend : titre puis synthèse. */
const FICHE_STOCKS: TrouveRechercheVue = {
	...TROUVE,
	id: 'projets/erp-saas/Module stocks.md',
	chemin: 'projets/erp-saas/Module stocks.md',
	genre: 'fiche',
	typeFiche: 'sujet',
	texte: 'Module stocks\n\nGestion des lots et des stocks par entrepôt.',
	contexte: 'projets › erp-saas › Module stocks',
};

type Appel = { params: Record<string, string>; signal: AbortSignal | undefined; repondre(trouves: TrouveRechercheVue[]): void };

/** `recherche` : réponse du moteur selon les paramètres ; `differee` : chaque appel attend que le test y réponde. */
function monter(o: { recherche?: (p: Record<string, string>) => TrouveRechercheVue[]; differee?: boolean; modeles?: 'absent' | 'arrete' | 'pret'; fiche?: () => unknown } = {}) {
	let modeles = o.modeles ?? 'pret';
	const appels: Appel[] = [];
	const recherche = o.recherche ?? ((p) => (p['q'] === 'stocks' ? [{ ...TROUVE, note: p['rapide'] === '1' ? null : 0.87 }] : []));
	const faux = creerFauxClient({
		'/api/sessions': { sessions: SESSIONS },
		...Object.fromEntries(SESSIONS.map((x) => [`/api/sessions/${x.id}`, { session: x }])),
		'/api/sante': { ok: true, pid: 1, racine: '~/Developer', racineAbsolue: '/Users/ana/Developer', terminaux: { ok: true }, version: '0.1.0' },
		'/api/memoire/graphe': GRAPHE,
		'/api/memoire/fiche': o.fiche ?? (() => new Promise(() => {})),
		'/api/dossiers': dossiersFaux([]),
		'/api/modeles': () => ({ reranker: modeles }),
		'/api/modeles/demarrer': () => {
			modeles = 'pret';
			return { reranker: modeles };
		},
		'/api/fil': { commits: [], tronque: false, aConfirmer: [], montees: [], modifications: [] },
		'/api/recherche': (p: Record<string, string> | undefined) => {
			const params = p ?? {};
			if (!o.differee) return { trouves: recherche(params), avis: {} };
			return new Promise((resoudre) => {
				const signal = (faux.api.lire.mock.calls.at(-1)?.[2] as { signal?: AbortSignal } | undefined)?.signal;
				appels.push({ params, signal, repondre: (trouves) => resoudre({ trouves, avis: {} }) });
			});
		},
	});
	render(<Application client={faux.client} />);
	const recherches = () =>
		faux.api.lire.mock.calls.filter(([chemin]) => chemin === '/api/recherche').map(([, params, options]) => ({ params: params as Record<string, string>, signal: (options as { signal?: AbortSignal } | undefined)?.signal }));
	return { faux, appels, recherches };
}

const options = () => within(screen.getByRole('listbox')).queryAllByRole('option');
const textes = () => options().map((x) => x.textContent ?? '');
const choisie = () => options().findIndex((x) => x.getAttribute('aria-selected') === 'true');

const vues = () => screen.getByRole('navigation', { name: 'Vues' });

async function ouvrirEtTaper(texte: string) {
	await act(async () => fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: /Chercher une session/ })));
	const champ = screen.getByRole('combobox', { name: 'Palette' });
	expect(document.activeElement).toBe(champ);
	fireEvent.change(champ, { target: { value: texte } });
	return champ;
}

describe('palette ⌘K', () => {
	it('⌘K / Ctrl+K ouvre la palette, Échap la ferme et rend le focus', async () => {
		monter();
		const memoire = within(vues()).getByRole('button', { name: /Mémoire/ });
		memoire.focus();
		await act(async () => fireEvent.keyDown(document, { code: 'KeyK', key: 'k', metaKey: true }));
		const champ = screen.getByRole('combobox', { name: 'Palette' });
		expect(document.activeElement).toBe(champ);
		await act(async () => fireEvent.keyDown(champ, { code: 'Escape', key: 'Escape' }));
		expect(screen.queryByRole('combobox', { name: 'Palette' })).toBeNull();
		expect(document.activeElement).toBe(memoire);
	});

	it('« stocks » : la session qui correspond nettement, puis le classement du moteur (mots seuls, puis complet)', async () => {
		const { recherches } = monter();
		await ouvrirEtTaper('stocks');
		await waitFor(() => expect(screen.getByText('87 %')).toBeTruthy());
		expect(textes()).toEqual([expect.stringContaining('Refondre le module stocks pour gérer les lots'), expect.stringContaining('premier périmé')]);
		expect(choisie()).toBe(0);
		// deux temps : les mots seuls (rapide=1), puis l'appel complet
		expect(recherches().map((r) => r.params['rapide'] ?? null)).toEqual(['1', null]);
		expect(recherches()[0]!.params).toMatchObject({ q: 'stocks' });
	});

	it('ordre du moteur : une fiche au titre correspondant mais mal notée passe après une meilleure réponse du moteur', async () => {
		monter({ recherche: () => [{ ...TROUVE, note: 0.9 }, { ...FICHE_STOCKS, note: 0.4 }] });
		await ouvrirEtTaper('stocks');
		await waitFor(() => expect(screen.getByText('90 %')).toBeTruthy());
		expect(textes()).toEqual([
			expect.stringContaining('Refondre le module stocks'),
			expect.stringContaining('premier périmé'),
			expect.stringContaining('Module stocks'),
		]);
		// la correspondance de titre (alias « responsable des stocks ») n'était qu'un affichage provisoire
		expect(screen.queryByText('Marc Lefèvre')).toBeNull();
	});

	it('sessions : seulement si objectif ou dossier correspond nettement (mot entier ou début de 3 lettres)', async () => {
		monter({ recherche: () => [] });
		const champ = await ouvrirEtTaper('csv');
		await waitFor(() => expect(textes()).toEqual([expect.stringContaining("Corriger l'export CSV")]));
		fireEvent.change(champ, { target: { value: 'ock' } });
		await waitFor(() => expect(textes()).toEqual([]));
		fireEvent.change(champ, { target: { value: 'sto lots' } });
		await waitFor(() => expect(textes()).toEqual([expect.stringContaining('Refondre le module stocks')]));
		fireEvent.change(champ, { target: { value: 'catalogue' } });
		await waitFor(() => expect(screen.getByText(/Rien ne correspond/)).toBeTruthy());
		expect(textes()).toEqual([]);
	});

	it('la palette ne demande l’historique (sessions terminées) qu’à son ouverture : fermée, aucune requête de sa part', async () => {
		const { faux } = monter({ recherche: () => [] });
		const historique = () => faux.api.lire.mock.calls.filter(([chemin]) => chemin === '/api/historique').length;
		// les requêtes du départ viennent d'autres vues (Sessions : compte des terminées), pas de la palette fermée
		await act(async () => new Promise((r) => setTimeout(r, 50)));
		const avant = historique();
		await act(async () => new Promise((r) => setTimeout(r, 50)));
		expect(historique()).toBe(avant);
		await ouvrirEtTaper('facture');
		await waitFor(() => expect(historique()).toBe(avant + 1));
	});

	it('une session terminée se trouve par son objectif, après les vivantes, avec son état', async () => {
		monter({ recherche: () => [] });
		await ouvrirEtTaper('facture durand');
		await waitFor(() => expect(textes()).toEqual([expect.stringContaining('Relance facture Durand')]));
		expect(within(options()[0]!).getByLabelText('Terminée')).toBeTruthy();
	});

	it('affichage provisoire (titres) puis remplacé par le moteur ; la sélection suit l’élément choisi', async () => {
		const { appels } = monter({ differee: true });
		const champ = await ouvrirEtTaper('stocks');
		expect(textes()).toEqual([expect.stringContaining('Refondre le module stocks'), expect.stringContaining('Module stocks'), expect.stringContaining('Marc Lefèvre')]);
		fireEvent.keyDown(champ, { key: 'ArrowDown' });
		expect(choisie()).toBe(1);
		await waitFor(() => expect(appels).toHaveLength(1));
		await act(async () => appels[0]!.repondre([{ ...TROUVE }, { ...FICHE_STOCKS }]));
		expect(textes()).toEqual([expect.stringContaining('Refondre le module stocks'), expect.stringContaining('premier périmé'), expect.stringContaining('Module stocks')]);
		// « Module stocks » reste choisie, à son nouveau rang
		expect(choisie()).toBe(2);
		await waitFor(() => expect(appels).toHaveLength(2));
		expect(appels[1]!.params['rapide']).toBeUndefined();
		await act(async () => appels[1]!.repondre([{ ...FICHE_STOCKS, note: 0.92 }, { ...TROUVE, note: 0.5 }]));
		expect(textes()).toEqual([expect.stringContaining('Refondre le module stocks'), expect.stringContaining('Module stocks'), expect.stringContaining('premier périmé')]);
		expect(choisie()).toBe(1);
		expect(screen.getByText('92 %')).toBeTruthy();
	});

	it('le texte change : la requête en cours est abandonnée ; rien sous deux caractères', async () => {
		const { appels, recherches } = monter({ differee: true });
		const champ = await ouvrirEtTaper('s');
		await new Promise((r) => setTimeout(r, 200));
		expect(recherches()).toEqual([]);
		fireEvent.change(champ, { target: { value: 'stocks' } });
		await waitFor(() => expect(appels).toHaveLength(1));
		const premier = recherches()[0]!.signal;
		expect(premier?.aborted).toBe(false);
		fireEvent.change(champ, { target: { value: 'stocks lots' } });
		expect(premier?.aborted).toBe(true);
		await waitFor(() => expect(appels).toHaveLength(2));
		expect(appels[1]!.params).toMatchObject({ q: 'stocks lots', rapide: '1' });
		// la réponse tardive de la requête abandonnée n'est pas affichée
		await act(async () => appels[0]!.repondre([{ ...TROUVE }]));
		expect(screen.queryByText(/premier périmé/)).toBeNull();
	});

	it('chaque résultat : genre (libellé accessible), titre, chemin court, extrait surligné ; jamais de HTML injecté', async () => {
		const piege = '<img src=x onerror="alert(1)">';
		monter({
			recherche: (p) => [
				{ ...FICHE_STOCKS, texte: `${piege} Module stocks\n\nGestion des stocks ${piege}`, note: p['rapide'] === '1' ? null : 0.66 },
				{ ...TROUVE, contexte: 'sources › Cahier des charges', note: null },
			],
		});
		await ouvrirEtTaper('stocks');
		await waitFor(() => expect(screen.getByText('66 %')).toBeTruthy());
		// le logo de la barre de titre est une image : seule la liste des résultats est en cause
		expect(screen.getByRole('listbox').querySelector('img')).toBeNull();
		const [fiche, fait] = options().slice(1);
		expect(fiche!.textContent).toContain(piege);
		expect(within(fiche!).getByLabelText('Fiche')).toBeTruthy();
		expect(fiche!.textContent).toContain('projets/erp-saas');
		const marques = [...fiche!.querySelectorAll('mark')].map((m) => m.textContent);
		expect(marques).toContain('stocks');
		// information d'un document : son genre, le titre de sa fiche, l'extrait ; sans note, pas de pourcentage
		expect(within(fait!).getByLabelText('Passage de document')).toBeTruthy();
		expect(fait!.textContent).toContain('Cahier des charges');
		expect([...fait!.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['stock']);
		expect(fait!.textContent).not.toContain('%');
	});

	it('filtres d’un clic : Tout, Sessions, Fiches, Documents ; ←/→ entre eux ; gardés pendant l’ouverture', async () => {
		const { recherches } = monter({
			// le service filtre lui-même par genre
			recherche: (p) => [...(p['genre'] === 'document' ? [] : [{ ...FICHE_STOCKS, note: null }]), ...(p['genre'] === 'fiche' ? [] : [{ ...TROUVE, note: null }])],
		});
		const champ = await ouvrirEtTaper('stocks');
		const filtres = screen.getByRole('group', { name: 'Filtres' });
		const bouton = (nom: string) => within(filtres).getByRole('button', { name: nom });
		expect(bouton('Tout').getAttribute('aria-pressed')).toBe('true');
		await waitFor(() => expect(textes()).toHaveLength(3));

		await act(async () => fireEvent.click(bouton('Sessions')));
		expect(bouton('Sessions').getAttribute('aria-pressed')).toBe('true');
		expect(textes()).toEqual([expect.stringContaining('Refondre le module stocks')]);

		await act(async () => fireEvent.click(bouton('Fiches')));
		await waitFor(() => expect(recherches().at(-1)!.params['genre']).toBe('fiche'));
		await waitFor(() => expect(textes()).toEqual([expect.stringContaining('Module stocks')]));

		// ←/→ : du bouton choisi au suivant, choisi à son tour
		bouton('Fiches').focus();
		await act(async () => fireEvent.keyDown(bouton('Fiches'), { key: 'ArrowRight' }));
		expect(bouton('Documents').getAttribute('aria-pressed')).toBe('true');
		expect(document.activeElement).toBe(bouton('Documents'));
		await waitFor(() => expect(recherches().at(-1)!.params['genre']).toBe('document'));
		expect(recherches().at(-1)!.params['dossier']).toBeUndefined();
		await waitFor(() => expect(textes()).toEqual([expect.stringContaining('premier périmé')]));
		await act(async () => fireEvent.keyDown(bouton('Documents'), { key: 'ArrowLeft' }));
		expect(bouton('Fiches').getAttribute('aria-pressed')).toBe('true');

		// le filtre reste quand le texte change
		fireEvent.change(champ, { target: { value: 'stock' } });
		expect(bouton('Fiches').getAttribute('aria-pressed')).toBe('true');
	});

	it('« Ce projet » : présent quand une session d’un projet est au premier plan ; borne sessions et moteur à sa position', async () => {
		const { recherches } = monter();
		await ouvrirEtTaper('stocks');
		const filtres = screen.getByRole('group', { name: 'Filtres' });
		const ceProjet = within(filtres).getByRole('button', { name: /Ce projet/ });
		expect(ceProjet.getAttribute('aria-pressed')).toBe('false');
		await act(async () => fireEvent.click(ceProjet));
		expect(ceProjet.getAttribute('aria-pressed')).toBe('true');
		await waitFor(() => expect(recherches().at(-1)!.params['dossier']).toBe('projets/erp-saas'));
	});

	it('« Ce projet » depuis Mémoire : le projet de la fiche ouverte (sous un projet)', async () => {
		const vue: FicheVue = {
			chemin: FICHE_STOCKS.chemin, titre: 'Module stocks', type: 'sujet', proprietes: [], corps: 'Gestion des lots.\n', brut: '# Module stocks\n', empreinte: 'e', liens: { sortants: [], entrants: [] }, sessions: [], sessionsTotal: 0, avertissements: [],
			projet: { projet: 'erp-saas', position: 'projets/erp-saas' },
		};
		const { recherches } = monter({ recherche: () => [{ ...FICHE_STOCKS }], fiche: () => vue });
		const champ = await ouvrirEtTaper('stocks');
		await within(screen.getByRole('listbox')).findByText(/Gestion des lots/);
		fireEvent.keyDown(champ, { key: 'ArrowDown' });
		await act(async () => fireEvent.keyDown(champ, { key: 'Enter' }));
		await waitFor(() => expect(within(vues()).getByRole('button', { name: /Mémoire/ }).getAttribute('aria-current')).toBe('page'));
		await ouvrirEtTaper('lots');
		const ceProjet = await within(screen.getByRole('group', { name: 'Filtres' })).findByRole('button', { name: /Ce projet/ });
		expect(ceProjet.textContent).toContain('erp-saas');
		await act(async () => fireEvent.click(ceProjet));
		await waitFor(() => expect(recherches().at(-1)!.params['dossier']).toBe('projets/erp-saas'));
	});

	it('« Ce projet » depuis Mémoire, sans session : le projet que le service rend avec la fiche, rangée hors de projets/', async () => {
		const DEVIS: TrouveRechercheVue = { ...FICHE_STOCKS, id: 'travail/acme/Devis.md', chemin: 'travail/acme/Devis.md', texte: 'Devis\n\nGestion des lots du devis.' };
		const vue: FicheVue = {
			chemin: DEVIS.chemin, titre: 'Devis', type: 'sujet', proprietes: [], corps: 'Gestion des lots du devis.\n', brut: '# Devis\n', empreinte: 'e', liens: { sortants: [], entrants: [] }, sessions: [], sessionsTotal: 0, avertissements: [],
			projet: { projet: 'Acme', position: 'travail/acme' },
		};
		const { recherches } = monter({ recherche: () => [{ ...DEVIS }], fiche: () => vue });
		const champ = await ouvrirEtTaper('stocks');
		await within(screen.getByRole('listbox')).findByText(/Gestion des lots/);
		fireEvent.keyDown(champ, { key: 'ArrowDown' });
		await act(async () => fireEvent.keyDown(champ, { key: 'Enter' }));
		await waitFor(() => expect(within(vues()).getByRole('button', { name: /Mémoire/ }).getAttribute('aria-current')).toBe('page'));
		await ouvrirEtTaper('lots');
		const ceProjet = await within(screen.getByRole('group', { name: 'Filtres' })).findByRole('button', { name: /Ce projet/ });
		expect(ceProjet.textContent).toContain('Acme');
		await act(async () => fireEvent.click(ceProjet));
		await waitFor(() => expect(recherches().at(-1)!.params['dossier']).toBe('travail/acme'));
	});

	it('« Ce projet » désactivé avec « Documents » (info-bulle), le moteur sans dossier ; rétabli en quittant Documents', async () => {
		const { recherches } = monter();
		await ouvrirEtTaper('stocks');
		const filtres = screen.getByRole('group', { name: 'Filtres' });
		const ceProjet = within(filtres).getByRole('button', { name: /Ce projet/ }) as HTMLButtonElement;
		await act(async () => fireEvent.click(ceProjet));
		await act(async () => fireEvent.click(within(filtres).getByRole('button', { name: 'Documents' })));
		expect(ceProjet.disabled).toBe(true);
		expect(ceProjet.getAttribute('aria-pressed')).toBe('false');
		expect(ceProjet.title).toMatch(/Documents/);
		await waitFor(() => expect(recherches().at(-1)!.params).toMatchObject({ genre: 'document' }));
		expect(recherches().at(-1)!.params['dossier']).toBeUndefined();
		await act(async () => fireEvent.click(within(filtres).getByRole('button', { name: 'Fiches' })));
		expect(ceProjet.disabled).toBe(false);
		expect(ceProjet.getAttribute('aria-pressed')).toBe('true');
		await waitFor(() => expect(recherches().at(-1)!.params).toMatchObject({ genre: 'fiche', dossier: 'projets/erp-saas' }));
	});

	it('modèles arrêtés : « mots seulement » et « Démarrer les modèles » (la palette ne les démarre jamais d’elle-même)', async () => {
		const { faux } = monter({ modeles: 'arrete', recherche: () => [{ ...TROUVE, note: null }] });
		await ouvrirEtTaper('stocks');
		const demarrer = await screen.findByRole('button', { name: 'Démarrer les modèles' });
		expect(screen.getByText(/Mots seulement/)).toBeTruthy();
		const demarrages = () => [...faux.api.lire.mock.calls, ...faux.api.envoyer.mock.calls].filter(([chemin]) => chemin === '/api/modeles/demarrer');
		expect(demarrages()).toEqual([]);
		await act(async () => fireEvent.click(demarrer));
		expect(demarrages()).toHaveLength(1);
		await screen.findByText(/Modèles démarrés/);
	});

	it('modèles prêts, ou réponse notée : pas de mention « mots seulement »', async () => {
		monter({ modeles: 'pret', recherche: () => [{ ...TROUVE, note: null }] });
		await ouvrirEtTaper('stocks');
		await within(screen.getByRole('listbox')).findByText(/premier périmé/);
		await new Promise((r) => setTimeout(r, 450));
		expect(screen.queryByText(/Mots seulement/)).toBeNull();
	});

	it('fiche et information de la même fiche : une seule option, l’information en sous-ligne (genre, note, extrait)', async () => {
		const info = { ...TROUVE, id: `${FICHE_STOCKS.chemin}#^f-0003`, chemin: FICHE_STOCKS.chemin, typeFiche: 'sujet', texte: 'Les stocks sont suivis par lot.', note: 0.61 };
		monter({ recherche: (p) => (p['rapide'] === '1' ? [] : [info, { ...FICHE_STOCKS, note: 0.5 }]) });
		await ouvrirEtTaper('stocks');
		await waitFor(() => expect(textes().some((t) => t.includes('suivis par lot'))).toBe(true));
		const groupe = options().filter((x) => x.textContent?.includes('Module stocks'));
		expect(groupe).toHaveLength(1);
		expect(groupe[0]!.textContent).toContain('suivis par lot');
		expect(groupe[0]!.textContent).toContain('61\u00a0%');
		expect(within(groupe[0]!).getAllByRole('img').map((x) => x.getAttribute('aria-label'))).toEqual(['Fiche', 'Information']);
	});

	it('menu aligné sur le champ de la barre de titre : même bord gauche, même largeur, juste dessous ; suit le champ et la fenêtre', async () => {
		monter();
		const commande = within(screen.getByRole('banner')).getByRole('button', { name: /Chercher une session/ });
		let rect = { left: 312, top: 8, bottom: 36, right: 732, width: 420, height: 28, x: 312, y: 8 };
		vi.spyOn(commande, 'getBoundingClientRect').mockImplementation(() => ({ ...rect, toJSON: () => rect }) as DOMRect);
		await ouvrirEtTaper('stocks');
		const menu = screen.getByRole('listbox').closest<HTMLElement>('[data-menu-palette]')!;
		expect(menu.style.left).toBe('312px');
		expect(menu.style.width).toBe('420px');
		expect(menu.style.top).toBe('40px');
		const champ = screen.getByRole('combobox', { name: 'Palette' }).closest<HTMLElement>('[data-champ-palette]')!;
		expect(champ.style.left).toBe('312px');
		expect(champ.style.width).toBe('420px');
		// champ rétréci (fenêtre étroite) : le menu garde le bord gauche et une largeur minimale
		rect = { ...rect, left: 200, width: 220, right: 420 };
		await act(async () => window.dispatchEvent(new Event('resize')));
		expect(menu.style.left).toBe('200px');
		expect(menu.style.width).toBe('360px');
		// un voisin apparaît dans la barre (la racine lue après coup) : le champ se déplace sans changer de taille, le menu suit
		rect = { ...rect, left: 260, right: 480 };
		await act(async () => {
			const voisin = document.createElement('span');
			voisin.textContent = '~/Developer';
			commande.before(voisin);
		});
		await waitFor(() => expect(menu.style.left).toBe('260px'));
		expect(champ.style.left).toBe('260px');
	});

	it('flèches puis Entrée sur un résultat du moteur → Mémoire › Fichiers, palette fermée', async () => {
		monter({ recherche: () => [{ ...TROUVE }, { ...FICHE_STOCKS }] });
		const champ = await ouvrirEtTaper('stocks');
		await waitFor(() => expect(textes()).toHaveLength(3));
		await within(screen.getByRole('listbox')).findByText(/premier périmé/);
		fireEvent.keyDown(champ, { key: 'ArrowDown' });
		fireEvent.keyDown(champ, { key: 'ArrowDown' });
		fireEvent.keyDown(champ, { key: 'ArrowUp' });
		expect(choisie()).toBe(1);
		await act(async () => fireEvent.keyDown(champ, { key: 'Enter' }));
		expect(screen.queryByRole('combobox', { name: 'Palette' })).toBeNull();
		expect(within(vues()).getByRole('button', { name: /Mémoire/ }).getAttribute('aria-current')).toBe('page');
		await waitFor(() => expect(screen.getByRole('tab', { name: 'Fichiers' }).getAttribute('aria-selected')).toBe('true'));
	});

	it('Entrée sur la session → vue Sessions, session en grand dans la grille', async () => {
		monter();
		await act(async () => fireEvent.click(within(vues()).getByRole('button', { name: /Mémoire/ })));
		const champ = await ouvrirEtTaper('stocks');
		await waitFor(() => expect(textes()[0]).toContain('Refondre le module stocks'));
		expect(choisie()).toBe(0);
		await act(async () => fireEvent.keyDown(champ, { key: 'Enter' }));
		await waitFor(() => expect(within(vues()).getByRole('button', { name: /Sessions/ }).getAttribute('aria-current')).toBe('page'));
		await waitFor(() => expect(document.querySelector('[data-cellule="s-stocks"]')?.getAttribute('data-zoomee')).toBe('true'));
	});

	it('Tab et Maj+Tab restent dans la palette (piège du focus) : du champ aux filtres et retour', async () => {
		monter();
		const champ = await ouvrirEtTaper('stocks');
		const tout = within(screen.getByRole('group', { name: 'Filtres' })).getByRole('button', { name: 'Tout' });
		// Le navigateur ne déplace pas le focus : la palette garde la main (événement annulé), le focus reste dedans.
		expect(fireEvent.keyDown(champ, { key: 'Tab' })).toBe(false);
		expect(document.activeElement).toBe(tout);
		expect(fireEvent.keyDown(tout, { key: 'Tab', shiftKey: true })).toBe(false);
		expect(document.activeElement).toBe(champ);
		expect(fireEvent.keyDown(champ, { key: 'Tab', shiftKey: true })).toBe(false);
		expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
		expect(screen.getByRole('combobox', { name: 'Palette' })).toBeTruthy();
	});
});
