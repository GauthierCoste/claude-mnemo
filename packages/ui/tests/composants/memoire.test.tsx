// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErreurApi } from '../../src/client/api.ts';
import { PARAMETRES_TOUT, PROFIL_TRAVAIL } from '@mnemo/commun';
import type { BilanAmorceVue, DocumentVue, DonneesGraphe, FicheGraphe, FicheVue, SessionTermineeVue, SessionVue } from '@mnemo/contrat';
import { Application } from '../../src/composants/Application.tsx';
import { dossiersFaux } from '../aides/dossiers-faux.ts';
import { stockage } from '../aides/stockage.ts';
import { creerFauxClient, demandeTout } from '../aides/faux-client.tsx';

// Le graphe (three.js) n'est pas le sujet ici.
vi.mock('../../src/composants/memoire/graphe/Graphe3D.tsx', () => ({ Graphe3D: () => <p>graphe simulé</p> }));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

const STOCKS = 'projets/erp-saas/Module stocks.md';
const MARC = 'personnes/Marc Lefèvre.md';

function ficheGraphe(chemin: string, faitsActifs: number): FicheGraphe {
	const m = chemin.split('/');
	return { chemin, titre: m.at(-1)!.replace(/\.md$/, ''), type: 'sujet', alias: [], etats: [], faitsActifs, categories: {}, dates: [], branche: m.slice(0, -1).join('/'), parent: null };
}

const GRAPHE: DonneesGraphe = {
	coffre: '_mnemo',
	fiches: [ficheGraphe(STOCKS, 2), ficheGraphe(MARC, 1), ficheGraphe('consignes/Tests.md', 0)],
	liens: [
		{ source: STOCKS, cible: MARC, cibleEcrite: 'Marc Lefèvre', relation: 'valide' },
		{ source: STOCKS, cible: null, cibleEcrite: 'Inventaire', relation: null },
	],
	notions: [],
	sens: { disponible: false, etat: 'absent' },
	modifieeMs: 1,
};

const BRUT_STOCKS = `---
id: 01J
type: sujet
updated: 2026-11-21
---
# Module stocks

Synthèse du module.

## Faits
- [delai] Livraison au 15/12/2026. | declare | a confirmer ^f-0001

## Relations
- validé par [[Marc Lefèvre]]
- voir [[Inventaire]]
`;

function vueStocks(o: Partial<FicheVue> = {}): FicheVue {
	return {
		chemin: STOCKS,
		titre: 'Module stocks',
		type: 'sujet',
		proprietes: [
			['type', 'sujet'],
			['updated', '2026-11-21'],
		],
		corps: BRUT_STOCKS.split('---\n')[2]!,
		brut: BRUT_STOCKS,
		empreinte: 'e1',
		liens: {
			sortants: [
				{ ecrit: 'Marc Lefèvre', chemin: MARC, verbe: 'validé par' },
				{ ecrit: 'Inventaire', chemin: null, verbe: 'voir' },
			],
			entrants: [{ chemin: MARC, titre: 'Marc Lefèvre', verbe: 'projet' }],
		},
		sessions: [{ id: 's1', objectif: 'Refondre le module stocks', etat: 'attend', horodatageMs: 1 }],
		sessionsTotal: 1,
		avertissements: [],
		projet: null,
		...o,
	};
}

const SESSION_S1: SessionVue = {
	id: 's1',
	profil: PROFIL_TRAVAIL,
	dossier: 'erp-saas',
	position: 'projets/erp-saas',
	projet: 'erp-saas',
	objectif: 'Refondre le module stocks',
	etat: 'attend',
	creeeMs: 1,
	majMs: 1,
	bilanDemandeMs: null,
	commitDebut: null,
	branche: null,
	terminal: true,
	dialogueOuvert: false,
	dossierNonRattache: null, niveauModeles: null,
};

const VUE_MARC: FicheVue = {
	chemin: MARC,
	titre: 'Marc Lefèvre',
	type: 'entite',
	proprietes: [['type', 'entite']],
	corps: '# Marc Lefèvre\n\nResponsable logistique.\n',
	brut: '---\ntype: entite\n---\n# Marc Lefèvre\n\nResponsable logistique.\n',
	empreinte: 'm1',
	liens: { sortants: [], entrants: [] },
	sessions: [],
	sessionsTotal: 0,
	avertissements: [],
	projet: null,
};

function monter(o: { stocks?: () => FicheVue; stocksTout?: () => FicheVue; brut?: (corps: unknown) => unknown; deplacer?: (corps: unknown) => unknown; amorce?: () => unknown; onglet?: 'fichiers' | 'archiviste'; plus?: Record<string, unknown> } = {}) {
	const faux = creerFauxClient({
		'/api/sessions/s1': { session: SESSION_S1 },
		'/api/historique': { sessions: [] },
		...o.plus,
		'/api/sessions': { sessions: [] },
		'/api/sante': { ok: true, pid: 1, racine: '~/Developer', racineAbsolue: '/Users/ana/Developer', terminaux: { ok: true }, version: '0.1.0' },
		'/api/fil': { commits: [], aConfirmer: [], montees: [], modifications: [] },
		'/api/memoire/graphe': GRAPHE,
		'/api/memoire/fiche': (p: Record<string, string> | undefined) =>
			p?.['chemin'] === MARC ? VUE_MARC : demandeTout(p) && o.stocksTout ? o.stocksTout() : (o.stocks ?? vueStocks)(),
		'/api/memoire/brut': (_: unknown, corps: unknown) => (o.brut ? o.brut(corps) : { statut: 'ok' }),
		'/api/deplacer': (_: unknown, corps: unknown) => (o.deplacer ? o.deplacer(corps) : { statut: 'ecrit', fiche: STOCKS, aConfirmer: false, commit: 'c1' }),
		'/api/memoire/amorce': () => (o.amorce ? o.amorce() : BILAN),
		'/api/memoire/documents': { documents: DOCUMENTS, aTraiter: DOCUMENTS.filter((d) => d.aTraiter), totalDocuments: DOCUMENTS.length, totalATraiter: DOCUMENTS.filter((d) => d.aTraiter).length },
		'/api/dossiers': dossiersFaux([{ chemin: 'erp-saas', git: true, marque: true }]),
	});
	render(<Application client={faux.client} depart={{ vue: 'memoire', ongletMemoire: o.onglet ?? 'fichiers' }} />);
	return faux;
}

async function ouvrirStocks() {
	const arbre = await screen.findByRole('navigation', { name: 'Fiches' });
	fireEvent.click(await within(arbre).findByRole('button', { name: 'Module stocks' }));
	return screen.findByRole('heading', { level: 1, name: 'Module stocks' });
}

const DOCUMENTS: DocumentVue[] = [
	{ chemin: 'sources/claude-code/notes.md', titre: 'Notes de Claude', document: null, date: '2026-11-21', aTraiter: true },
	{ chemin: 'sources/cdc-stocks-v2.md', titre: 'Cahier des charges stocks', document: 'erp-saas/docs/cdc-stocks-v2.pdf', date: '2026-11-18', aTraiter: false },
];

const BILAN: BilanAmorceVue = {
	notes: { nouvelles: 3, modifiees: 1, inchangees: 60 },
	instructions: { nouvelles: 2, modifiees: 0, inchangees: 5 },
	rattachees: 2,
	secrets: 1,
	ignores: [{ chemin: 'Projets/Mnemo/.claude/settings.local.json', raison: 'pas un fichier .md' }],
	fiches: ['sources/claude-code/p/a.md'],
	aTraiter: 6,
	archiviste: 'en_attente',
	avertissements: ['Passages non indexés pour sources/claude-code/p/CLAUDE.md : illisible'],
	commit: 'c2',
};

const zone = () => screen.getByRole('textbox', { name: 'Markdown de la fiche' }) as HTMLTextAreaElement;

describe('Mémoire › Fichiers : panneaux redimensionnables', () => {
	afterEach(() => vi.unstubAllGlobals());
	const poignee = (nom: string) => screen.getByRole('separator', { name: nom });
	const colonne = (nom: string, variable: string) => poignee(nom).parentElement!.style.getPropertyValue(variable);

	it('arbre : 260 px par défaut ; → élargit, gardée ; Début : minimum ; double-clic revient au défaut', async () => {
		const valeurs = stockage();
		monter();
		await screen.findByRole('navigation', { name: 'Fiches' });
		expect(colonne('Largeur du panneau Arbre', '--l-arbre')).toBe('260px');
		await act(async () => fireEvent.keyDown(poignee('Largeur du panneau Arbre'), { key: 'ArrowRight' }));
		expect(colonne('Largeur du panneau Arbre', '--l-arbre')).toBe('280px');
		expect(valeurs.get('mnemo.memoire.largeurArbre')).toBe('280');
		await act(async () => fireEvent.keyDown(poignee('Largeur du panneau Arbre'), { key: 'Home' }));
		expect(colonne('Largeur du panneau Arbre', '--l-arbre')).toBe('180px');
		await act(async () => fireEvent.doubleClick(poignee('Largeur du panneau Arbre')));
		expect(colonne('Largeur du panneau Arbre', '--l-arbre')).toBe('260px');
		expect(valeurs.has('mnemo.memoire.largeurArbre')).toBe(false);
	});

	it('liens : poignée à gauche du panneau (← élargit), la même sans fiche ouverte puis avec une fiche ouverte', async () => {
		const valeurs = stockage();
		monter();
		await screen.findByRole('navigation', { name: 'Fiches' });
		expect(colonne('Largeur du panneau Liens', '--l-liens')).toBe('280px');
		await ouvrirStocks();
		expect(screen.getAllByRole('separator', { name: 'Largeur du panneau Liens' })).toHaveLength(1);
		await act(async () => fireEvent.keyDown(poignee('Largeur du panneau Liens'), { key: 'ArrowLeft' }));
		expect(colonne('Largeur du panneau Liens', '--l-liens')).toBe('300px');
		expect(valeurs.get('mnemo.memoire.largeurLiens')).toBe('300');
	});

	it('largeur gardée relue au montage, bornée à 40 % de la fenêtre', async () => {
		stockage().set('mnemo.memoire.largeurArbre', '99999');
		monter();
		await screen.findByRole('navigation', { name: 'Fiches' });
		expect(colonne('Largeur du panneau Arbre', '--l-arbre')).toBe(`${Math.floor(window.innerWidth * 0.4)}px`);
	});

	it('sans stockage du navigateur : largeur par défaut, et la poignée règle quand même la largeur', async () => {
		vi.stubGlobal('localStorage', undefined);
		monter();
		await screen.findByRole('navigation', { name: 'Fiches' });
		await act(async () => fireEvent.keyDown(poignee('Largeur du panneau Arbre'), { key: 'ArrowRight' }));
		expect(colonne('Largeur du panneau Arbre', '--l-arbre')).toBe('280px');
	});
});

describe('Mémoire › Fichiers', () => {
	it('barre : statistiques « n fiches | n informations | n liens »', async () => {
		monter();
		expect(await screen.findByText('3 fiches | 3 informations | 2 liens')).toBeTruthy();
	});

	it('arbre : dossiers repliables, filtre, fiche courante en `.on`', async () => {
		monter();
		const arbre = await screen.findByRole('navigation', { name: 'Fiches' });
		await within(arbre).findByRole('button', { name: 'Module stocks' });
		fireEvent.click(within(arbre).getByRole('button', { name: 'erp-saas' }));
		expect(within(arbre).queryByRole('button', { name: 'Module stocks' })).toBeNull();
		fireEvent.click(within(arbre).getByRole('button', { name: 'erp-saas' }));
		fireEvent.change(screen.getByPlaceholderText('Filtrer les fichiers'), { target: { value: 'lefevre' } });
		expect(within(arbre).queryByRole('button', { name: 'Module stocks' })).toBeNull();
		expect(within(arbre).getByRole('button', { name: 'Marc Lefèvre' })).toBeTruthy();
		fireEvent.change(screen.getByPlaceholderText('Filtrer les fichiers'), { target: { value: '' } });
		await ouvrirStocks();
		expect(within(arbre).getByRole('button', { name: 'Module stocks' }).className.split(' ')).toContain('on');
	});

	it('fiche : fil d’Ariane, titre, propriétés, corps rendu, liens et sessions', async () => {
		monter();
		await ouvrirStocks();
		expect(screen.getByText('projets / erp-saas / Module stocks.md')).toBeTruthy();
		const props = document.querySelector('dl[aria-label="Propriétés"]')!;
		expect(props.textContent).toBe('typesujetmodifié21.11.2026');
		expect(screen.getByText('Synthèse du module.')).toBeTruthy();
		const liens = screen.getByRole('complementary', { name: 'Liens de la fiche' });
		expect(within(liens).getByText('Liens entrants (1)')).toBeTruthy();
		expect(within(liens).getByText('Liens sortants (2)')).toBeTruthy();
		expect(within(liens).getByRole('button', { name: 'Refondre le module stocks' })).toBeTruthy();
	});

	it('fiche lue hors de sa forme : ses avertissements sont listés ; aucun bloc sans avertissement', async () => {
		const avertissement = 'une ligne de « Informations » hors de la forme attendue (« - Tarif | 650 € ») : indexée comme texte';
		monter({ stocks: () => vueStocks({ avertissements: [avertissement] }) });
		await ouvrirStocks();
		const bloc = screen.getByRole('note', { name: 'À vérifier dans cette fiche' });
		expect(within(bloc).getByRole('listitem').textContent).toBe(avertissement);
	});

	it('fiche que Mnemo ne suggère plus jamais : dit en tête, « Rétablir » la rétablit et l’avis disparaît', async () => {
		let toujours = [{ chemin: STOCKS, titre: 'Module stocks', horodatageMs: new Date(2026, 10, 25, 10).getTime() }];
		const faux = monter({
			plus: {
				'/api/ecartees-toujours': () => ({ ecarteesToujours: toujours }),
				'DELETE /api/ecartees-toujours': () => {
					toujours = [];
					return { ecarteesToujours: toujours };
				},
			},
		});
		await ouvrirStocks();
		const avis = await screen.findByText(/^Mnemo ne suggère plus cette fiche, dans aucune session/u);
		expect(avis.textContent).toContain('le 25.11.2026');
		fireEvent.click(within(avis.parentElement!).getByRole('button', { name: 'Rétablir' }));
		await waitFor(() => expect(screen.queryByText(/^Mnemo ne suggère plus cette fiche/u)).toBeNull());
		expect(faux.api.supprimer).toHaveBeenCalledWith('/api/ecartees-toujours', { chemin: STOCKS });
	});

	it('fiche bien lue : pas de bloc « À vérifier »', async () => {
		monter();
		await ouvrirStocks();
		expect(screen.queryByRole('note', { name: 'À vérifier dans cette fiche' })).toBeNull();
	});

	it('sessions de la fiche coupées : « N de plus » ; « Tout voir » demande toutes les sessions, la fiche reste lue', async () => {
		const sessions = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, objectif: `Session ${i}`, etat: 'terminee' as const, horodatageMs: i }));
		const toutes = [...sessions, ...Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, objectif: `Ancienne ${i}`, etat: 'terminee' as const, horodatageMs: 100 + i }))];
		const faux = monter({ stocks: () => vueStocks({ sessions, sessionsTotal: 25 }), stocksTout: () => vueStocks({ sessions: toutes, sessionsTotal: 25 }) });
		await ouvrirStocks();
		const liens = screen.getByRole('complementary', { name: 'Liens de la fiche' });
		expect(within(liens).getByText('Sessions qui l\'ont utilisée (25)')).toBeTruthy();
		expect(within(liens).getByText('5 de plus')).toBeTruthy();
		fireEvent.click(within(liens).getByRole('button', { name: 'Tout voir' }));
		expect(await within(liens).findByRole('button', { name: 'Ancienne 4' })).toBeTruthy();
		expect(within(liens).queryByText('5 de plus')).toBeNull();
		expect(faux.api.lire).toHaveBeenCalledWith('/api/memoire/fiche', { chemin: STOCKS, ...PARAMETRES_TOUT });
		expect(screen.getByRole('heading', { level: 1, name: 'Module stocks' })).toBeTruthy();
	});

	it('clic sur un lien du corps ouvre la fiche ; lien absent → toast', async () => {
		monter();
		await ouvrirStocks();
		const corps = screen.getByRole('article');
		fireEvent.click(within(corps).getByRole('button', { name: 'Inventaire' }));
		expect(screen.getByRole('status').textContent).toBe('Fiche « Inventaire » absente');
		fireEvent.click(within(corps).getByRole('button', { name: 'Marc Lefèvre' }));
		expect(await screen.findByRole('heading', { level: 1, name: 'Marc Lefèvre' })).toBeTruthy();
	});

	it('liens : clic sur un lien entrant ouvre la fiche ; « Aucun. » / « Aucune. » ; session → vue Sessions', async () => {
		monter();
		await ouvrirStocks();
		const liens = () => screen.getByRole('complementary', { name: 'Liens de la fiche' });
		fireEvent.click(within(liens()).getAllByRole('button', { name: 'Marc Lefèvre' })[0]!);
		await screen.findByRole('heading', { level: 1, name: 'Marc Lefèvre' });
		expect(await within(liens()).findAllByText('Aucun.')).toHaveLength(2);
		expect(within(liens()).getByText('Aucune.')).toBeTruthy();
		await ouvrirStocks();
		fireEvent.click(await within(liens()).findByRole('button', { name: 'Refondre le module stocks' }));
		await waitFor(() => expect(screen.getByRole('main').getAttribute('data-vue')).toBe('sessions'));
	});

	it('session terminée demandée depuis la fiche : vue Sessions, tiroir des terminées ouvert sur sa ligne', async () => {
		const terminee: SessionTermineeVue = { ...SESSION_S1, id: 'sT', objectif: 'Migration des stocks', etat: 'terminee', episode: null };
		monter({
			stocks: () => vueStocks({ sessions: [{ id: 'sT', objectif: 'Migration des stocks', etat: 'terminee', horodatageMs: 1 }] }),
			plus: { '/api/sessions/sT': { session: terminee }, '/api/historique': { sessions: [terminee] } },
		});
		await ouvrirStocks();
		fireEvent.click(await within(screen.getByRole('complementary', { name: 'Liens de la fiche' })).findByRole('button', { name: 'Migration des stocks' }));
		await waitFor(() => expect(screen.getByRole('main').getAttribute('data-vue')).toBe('sessions'));
		const tiroir = await screen.findByRole('complementary', { name: 'Sessions terminées' });
		expect(tiroir.getAttribute('data-ouvert')).toBe('true');
		await waitFor(() => expect(tiroir.querySelector('[aria-current="true"]')?.textContent).toContain('Migration des stocks'));
	});

	it('session terminée absente de l’historique, même relu : le tiroir des terminées le dit', async () => {
		const terminee: SessionTermineeVue = { ...SESSION_S1, id: 'sT', objectif: 'Migration des stocks', etat: 'terminee', episode: null };
		monter({
			stocks: () => vueStocks({ sessions: [{ id: 'sT', objectif: 'Migration des stocks', etat: 'terminee', horodatageMs: 1 }] }),
			plus: { '/api/sessions/sT': { session: terminee }, '/api/historique': { sessions: [] } },
		});
		await ouvrirStocks();
		fireEvent.click(await within(screen.getByRole('complementary', { name: 'Liens de la fiche' })).findByRole('button', { name: 'Migration des stocks' }));
		const tiroir = await screen.findByRole('complementary', { name: 'Sessions terminées' });
		expect(await within(tiroir).findByText('La session demandée n’est pas dans l’historique.')).toBeTruthy();
	});

	it('session terminée absente de l’historique : pendant la relecture, aucun message « introuvable », même un instant', async () => {
		const terminee: SessionTermineeVue = { ...SESSION_S1, id: 'sT', objectif: 'Migration des stocks', etat: 'terminee', episode: null };
		let lectures = 0;
		monter({
			stocks: () => vueStocks({ sessions: [{ id: 'sT', objectif: 'Migration des stocks', etat: 'terminee', horodatageMs: 1 }] }),
			plus: { '/api/sessions/sT': { session: terminee }, '/api/historique': () => (lectures++ === 0 ? { sessions: [] } : new Promise(() => {})) },
		});
		const vus: string[] = [];
		const observateur = new MutationObserver(() => {
			if (document.body.textContent?.includes('pas dans l’historique')) vus.push('introuvable');
		});
		observateur.observe(document.body, { childList: true, subtree: true, characterData: true });
		await ouvrirStocks();
		fireEvent.click(await within(screen.getByRole('complementary', { name: 'Liens de la fiche' })).findByRole('button', { name: 'Migration des stocks' }));
		await screen.findByRole('complementary', { name: 'Sessions terminées' });
		await waitFor(() => expect(lectures).toBeGreaterThanOrEqual(2));
		await act(async () => {});
		observateur.disconnect();
		expect(vus).toEqual([]);
	});

	it('session introuvable : le motif du service en toast, la vue ne change pas', async () => {
		monter({
			stocks: () => vueStocks({ sessions: [{ id: 'sX', objectif: 'Retirée', etat: 'terminee', horodatageMs: 1 }] }),
			plus: {
				'/api/sessions/sX': () => {
					throw new ErreurApi('Session inconnue.', 404);
				},
			},
		});
		await ouvrirStocks();
		fireEvent.click(await within(screen.getByRole('complementary', { name: 'Liens de la fiche' })).findByRole('button', { name: 'Retirée' }));
		expect(await screen.findByText('Session inconnue.')).toBeTruthy();
		expect(screen.getByRole('main').getAttribute('data-vue')).toBe('memoire');
	});

	it('« Voir dans le graphe » passe à l’onglet Graph 3D', async () => {
		monter();
		await ouvrirStocks();
		fireEvent.click(screen.getByRole('button', { name: 'Voir dans le graphe' }));
		expect(screen.getByRole('tab', { name: 'Graph 3D' }).getAttribute('aria-selected')).toBe('true');
	});

	it('« Déplacer » : dossier saisi → `deplacer` { id, dossier }, puis la fiche au chemin rendu par le service', async () => {
		// le service rend le nouveau chemin : l'interface l'ouvre tel quel, sans le recalculer
		const deplacer = vi.fn(() => ({ statut: 'ecrit', fiche: 'archives/Module stocks (2).md', aConfirmer: false, commit: 'c1' }));
		const faux = monter({ deplacer });
		await ouvrirStocks();
		fireEvent.click(screen.getByRole('button', { name: 'Déplacer' }));
		fireEvent.change(screen.getByRole('textbox', { name: 'Dossier d’arrivée' }), { target: { value: 'archives/' } });
		fireEvent.click(screen.getByRole('button', { name: 'Déplacer ici' }));
		await waitFor(() => expect(deplacer).toHaveBeenCalledWith({ id: STOCKS, dossier: 'archives' }));
		await waitFor(() => expect(faux.api.lire).toHaveBeenCalledWith('/api/memoire/fiche', { chemin: 'archives/Module stocks (2).md' }));
	});

	it('édition : la zone reçoit le brut ; « Enregistrer » → `brut` avec l’empreinte lue', async () => {
		const brut = vi.fn(() => ({ statut: 'ok' }));
		monter({ brut });
		await ouvrirStocks();
		fireEvent.click(screen.getByRole('switch', { name: 'Édition' }));
		expect(zone().value).toBe(BRUT_STOCKS);
		fireEvent.change(zone(), { target: { value: `${BRUT_STOCKS}- ajout\n` } });
		fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
		await waitFor(() => expect(brut).toHaveBeenCalledWith({ chemin: STOCKS, texte: `${BRUT_STOCKS}- ajout\n`, empreinte: 'e1' }));
		await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Markdown de la fiche' })).toBeNull());
		expect(screen.getByRole('status').textContent).toBe('Fiche enregistrée');
	});

	it('enregistrée avec un avertissement (index en panne) : le toast dit l’enregistrement et l’avertissement', async () => {
		monter({ brut: () => ({ statut: 'ecrit', fiche: STOCKS, aConfirmer: false, commit: 'abc', avertissements: ['index en panne'] }) });
		await ouvrirStocks();
		fireEvent.click(screen.getByRole('switch', { name: 'Édition' }));
		fireEvent.change(zone(), { target: { value: `${BRUT_STOCKS}- ajout\n` } });
		fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
		await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Fiche enregistrée'));
		expect(within(screen.getByRole('list', { name: 'Avertissements' })).getByText('Avertissement : index en panne')).toBeTruthy();
	});

	it('409 : avis « La fiche a changé depuis l’ouverture », texte gardé ; « Recharger » reprend la fiche du disque', async () => {
		let courante = vueStocks();
		monter({
			stocks: () => courante,
			brut: () => {
				throw new ErreurApi("La fiche a changé depuis l'ouverture.", 409);
			},
		});
		await ouvrirStocks();
		fireEvent.click(screen.getByRole('switch', { name: 'Édition' }));
		fireEvent.change(zone(), { target: { value: 'mon texte' } });
		courante = vueStocks({ brut: 'version du disque', empreinte: 'e2' });
		fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
		const avis = await screen.findByRole('alert');
		expect(avis.textContent).toContain("La fiche a changé depuis l'ouverture");
		expect(zone().value).toBe('mon texte');
		fireEvent.click(within(avis).getByRole('button', { name: 'Recharger' }));
		await waitFor(() => expect(zone().value).toBe('version du disque'));
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('400 : le motif du refus est affiché, le texte reste', async () => {
		monter({
			brut: () => {
				throw new ErreurApi('Le type de la fiche ne se change pas.', 400);
			},
		});
		await ouvrirStocks();
		fireEvent.click(screen.getByRole('switch', { name: 'Édition' }));
		fireEvent.change(zone(), { target: { value: 'type: autre' } });
		fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
		expect((await screen.findByRole('alert')).textContent).toContain('Le type de la fiche ne se change pas.');
		expect(zone().value).toBe('type: autre');
	});

	it('message `memoire` hors édition : la fiche est rechargée', async () => {
		let courante = vueStocks();
		const faux = monter({ stocks: () => courante });
		await ouvrirStocks();
		courante = vueStocks({ corps: '# Module stocks\n\nNouvelle synthèse.\n', empreinte: 'e2' });
		act(() => faux.connexion.emettre({ type: 'memoire', modifieeMs: 2 }));
		expect(await screen.findByText('Nouvelle synthèse.')).toBeTruthy();
	});

	it('message `memoire` pendant l’édition : zone intacte, avis « La fiche a changé sur le disque » si l’empreinte a changé', async () => {
		let courante = vueStocks();
		const faux = monter({ stocks: () => courante });
		await ouvrirStocks();
		fireEvent.click(screen.getByRole('switch', { name: 'Édition' }));
		fireEvent.change(zone(), { target: { value: 'mon texte' } });
		// Même empreinte : aucun avis.
		act(() => faux.connexion.emettre({ type: 'memoire', modifieeMs: 2 }));
		await waitFor(() => expect(faux.api.lire.mock.calls.filter(([c]) => c === '/api/memoire/fiche').length).toBeGreaterThanOrEqual(2));
		expect(screen.queryByRole('alert')).toBeNull();
		courante = vueStocks({ brut: 'version du disque', empreinte: 'e2' });
		act(() => faux.connexion.emettre({ type: 'memoire', modifieeMs: 3 }));
		const avis = await screen.findByRole('alert');
		expect(avis.textContent).toContain('La fiche a changé sur le disque');
		expect(zone().value).toBe('mon texte');
		fireEvent.click(within(avis).getByRole('button', { name: 'Recharger' }));
		expect(zone().value).toBe('version du disque');
	});

	it('grande mémoire : l’arbre affiche 400 lignes au plus et dit combien il en reste', async () => {
		const fiches = Array.from({ length: 600 }, (_, i) => ficheGraphe(`personnes/P${String(i).padStart(3, '0')}.md`, 0));
		const faux = creerFauxClient({
			'/api/sessions': { sessions: [] },
			'/api/sante': { ok: true, pid: 1, racine: '~/Developer', racineAbsolue: '/Users/ana/Developer', terminaux: { ok: true }, version: '0.1.0' },
			'/api/fil': { commits: [], aConfirmer: [], montees: [], modifications: [] },
			'/api/memoire/graphe': { ...GRAPHE, fiches, liens: [] },
		});
		render(<Application client={faux.client} depart={{ vue: 'memoire', ongletMemoire: 'fichiers' }} />);
		const arbre = await screen.findByRole('navigation', { name: 'Fiches' });
		await within(arbre).findByRole('button', { name: 'P000' });
		expect(within(arbre).getAllByRole('button')).toHaveLength(400);
		expect(within(arbre).getByText('201 lignes de plus : filtrer, ou replier des dossiers.')).toBeTruthy();
		fireEvent.change(screen.getByPlaceholderText('Filtrer les fichiers'), { target: { value: 'P59' } });
		expect(within(arbre).getAllByRole('button').map((b) => b.textContent)).toEqual(['personnes', ...Array.from({ length: 10 }, (_, i) => `P59${i}`)]);
	});

	describe('modifications non enregistrées', () => {
		async function editerStocks() {
			const faux = monter();
			await ouvrirStocks();
			fireEvent.click(screen.getByRole('switch', { name: 'Édition' }));
			fireEvent.change(zone(), { target: { value: 'mon texte' } });
			return faux;
		}
		const avis = () => screen.getByRole('alertdialog', { name: 'Modifications non enregistrées' });

		it('quitter par l’arbre → avis ; « Rester » garde le texte ; « Abandonner » ouvre l’autre fiche', async () => {
			await editerStocks();
			const arbre = screen.getByRole('navigation', { name: 'Fiches' });
			fireEvent.click(within(arbre).getByRole('button', { name: 'Marc Lefèvre' }));
			fireEvent.click(within(avis()).getByRole('button', { name: 'Rester' }));
			expect(screen.queryByRole('alertdialog')).toBeNull();
			expect(zone().value).toBe('mon texte');
			expect(screen.getByRole('heading', { level: 1, name: 'Module stocks' })).toBeTruthy();
			fireEvent.click(within(arbre).getByRole('button', { name: 'Marc Lefèvre' }));
			fireEvent.click(within(avis()).getByRole('button', { name: 'Abandonner les modifications' }));
			expect(await screen.findByRole('heading', { level: 1, name: 'Marc Lefèvre' })).toBeTruthy();
		});

		it('quitter par un lien (#links) → avis ; « Rester » garde le texte', async () => {
			await editerStocks();
			const liens = screen.getByRole('complementary', { name: 'Liens de la fiche' });
			fireEvent.click(within(liens).getAllByRole('button', { name: 'Marc Lefèvre' })[0]!);
			fireEvent.click(within(avis()).getByRole('button', { name: 'Rester' }));
			expect(zone().value).toBe('mon texte');
		});

		it('couper « Édition » → avis ; « Rester » garde le texte ; « Abandonner » quitte l’édition', async () => {
			await editerStocks();
			fireEvent.click(screen.getByRole('switch', { name: 'Édition' }));
			fireEvent.click(within(avis()).getByRole('button', { name: 'Rester' }));
			expect(zone().value).toBe('mon texte');
			fireEvent.click(screen.getByRole('switch', { name: 'Édition' }));
			fireEvent.click(within(avis()).getByRole('button', { name: 'Abandonner les modifications' }));
			expect(screen.queryByRole('textbox', { name: 'Markdown de la fiche' })).toBeNull();
		});

		it('« Enregistrer » depuis l’avis : `brut` puis l’autre fiche', async () => {
			const faux = await editerStocks();
			fireEvent.click(within(screen.getByRole('navigation', { name: 'Fiches' })).getByRole('button', { name: 'Marc Lefèvre' }));
			fireEvent.click(within(avis()).getByRole('button', { name: 'Enregistrer' }));
			expect(await screen.findByRole('heading', { level: 1, name: 'Marc Lefèvre' })).toBeTruthy();
			expect(faux.api.envoyer).toHaveBeenCalledWith('/api/memoire/brut', { chemin: STOCKS, texte: 'mon texte', empreinte: 'e1' });
		});

		it('« Déplacer » pendant une édition modifiée → avis', async () => {
			await editerStocks();
			fireEvent.click(screen.getByRole('button', { name: 'Déplacer' }));
			fireEvent.click(screen.getByRole('button', { name: 'Déplacer ici' }));
			expect(avis()).toBeTruthy();
		});

		it('édition sans modification : on quitte sans avis ; `beforeunload` retenu seulement si modifié', async () => {
			monter();
			await ouvrirStocks();
			fireEvent.click(screen.getByRole('switch', { name: 'Édition' }));
			const libre = new Event('beforeunload', { cancelable: true });
			window.dispatchEvent(libre);
			expect(libre.defaultPrevented).toBe(false);
			fireEvent.change(zone(), { target: { value: 'mon texte' } });
			const retenu = new Event('beforeunload', { cancelable: true });
			window.dispatchEvent(retenu);
			expect(retenu.defaultPrevented).toBe(true);
			fireEvent.change(zone(), { target: { value: BRUT_STOCKS } });
			fireEvent.click(within(screen.getByRole('navigation', { name: 'Fiches' })).getByRole('button', { name: 'Marc Lefèvre' }));
			expect(await screen.findByRole('heading', { level: 1, name: 'Marc Lefèvre' })).toBeTruthy();
		});
	});

	it('zone en lecture seule pendant l’enregistrement', async () => {
		let finir: (v: unknown) => void = () => {};
		monter({ brut: () => new Promise((r) => (finir = r)) });
		await ouvrirStocks();
		fireEvent.click(screen.getByRole('switch', { name: 'Édition' }));
		fireEvent.change(zone(), { target: { value: 'x' } });
		fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
		await waitFor(() => expect(zone().readOnly).toBe(true));
		await act(async () => finir({ statut: 'ok' }));
	});

	it('fiche disparue (relecture en erreur) : avis « Cette fiche n’existe plus à cet endroit », texte gardé, enregistrement bloqué', async () => {
		let disparue = false;
		const faux = monter({
			stocks: () => {
				if (disparue) throw new ErreurApi('Fiche introuvable.', 404);
				return vueStocks();
			},
		});
		await ouvrirStocks();
		fireEvent.click(screen.getByRole('switch', { name: 'Édition' }));
		fireEvent.change(zone(), { target: { value: 'mon texte' } });
		disparue = true;
		act(() => faux.connexion.emettre({ type: 'memoire', modifieeMs: 2 }));
		expect((await screen.findByRole('alert')).textContent).toContain("Cette fiche n'existe plus à cet endroit");
		expect(zone().value).toBe('mon texte');
		expect((screen.getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('relecture en erreur autre que 404 (service injoignable) : pas d’avis « n’existe plus », texte gardé', async () => {
		let panne = false;
		const faux = monter({
			stocks: () => {
				if (panne) throw new ErreurApi('Service injoignable.', 0);
				return vueStocks();
			},
		});
		await ouvrirStocks();
		fireEvent.click(screen.getByRole('switch', { name: 'Édition' }));
		fireEvent.change(zone(), { target: { value: 'mon texte' } });
		panne = true;
		act(() => faux.connexion.emettre({ type: 'memoire', modifieeMs: 2 }));
		const alerte = await screen.findByRole('alert');
		expect(alerte.textContent).not.toContain("n'existe plus");
		expect(alerte.textContent).toContain('Service injoignable.');
		expect(zone().value).toBe('mon texte');
	});

	it('refus 400 puis fiche changée sur le disque : les deux avis', async () => {
		let courante = vueStocks();
		const faux = monter({
			stocks: () => courante,
			brut: () => {
				throw new ErreurApi('Le type de la fiche ne se change pas.', 400);
			},
		});
		await ouvrirStocks();
		fireEvent.click(screen.getByRole('switch', { name: 'Édition' }));
		fireEvent.change(zone(), { target: { value: 'type: autre' } });
		fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
		await screen.findByRole('alert');
		courante = vueStocks({ brut: 'version du disque', empreinte: 'e2' });
		act(() => faux.connexion.emettre({ type: 'memoire', modifieeMs: 2 }));
		await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
		const textes = screen.getAllByRole('alert').map((a) => a.textContent);
		expect(textes.some((t) => t?.includes('Le type de la fiche ne se change pas.'))).toBe(true);
		expect(textes.some((t) => t?.includes('La fiche a changé sur le disque'))).toBe(true);
	});

	it('arbre : libellés isolés (U+202E) dans un <bdi>', async () => {
		const faux = creerFauxClient({
			'/api/sessions': { sessions: [] },
			'/api/sante': { ok: true, pid: 1, racine: '~/Developer', racineAbsolue: '/Users/ana/Developer', terminaux: { ok: true }, version: '0.1.0' },
			'/api/fil': { commits: [], aConfirmer: [], montees: [], modifications: [] },
			'/api/memoire/graphe': { ...GRAPHE, fiches: [ficheGraphe('d\u202Eir/ab\u202Ecd.md', 0)], liens: [] },
		});
		render(<Application client={faux.client} depart={{ vue: 'memoire', ongletMemoire: 'fichiers' }} />);
		const arbre = await screen.findByRole('navigation', { name: 'Fiches' });
		await within(arbre).findByRole('button', { name: 'ab\u202Ecd' });
		expect([...arbre.querySelectorAll('bdi')].map((b) => b.textContent)).toEqual(['d\u202Eir', 'ab\u202Ecd']);
	});

	it('mode démo : revenir à la fiche de départ ne la rouvre pas en édition', async () => {
		const faux = creerFauxClient({
			'/api/sessions': { sessions: [] },
			'/api/sante': { ok: true, pid: 1, racine: '~/Developer', racineAbsolue: '/Users/ana/Developer', terminaux: { ok: true }, version: '0.1.0' },
			'/api/fil': { commits: [], aConfirmer: [], montees: [], modifications: [] },
			'/api/memoire/graphe': GRAPHE,
			'/api/memoire/fiche': (p: Record<string, string> | undefined) => (p?.['chemin'] === MARC ? VUE_MARC : vueStocks()),
		});
		render(<Application client={faux.client} depart={{ vue: 'memoire', ongletMemoire: 'fichiers', fiche: STOCKS, edition: true }} />);
		await waitFor(() => expect(zone().value).toBe(BRUT_STOCKS));
		const arbre = screen.getByRole('navigation', { name: 'Fiches' });
		fireEvent.click(await within(arbre).findByRole('button', { name: 'Marc Lefèvre' }));
		await screen.findByRole('heading', { level: 1, name: 'Marc Lefèvre' });
		fireEvent.click(within(arbre).getByRole('button', { name: 'Module stocks' }));
		await screen.findByRole('heading', { level: 1, name: 'Module stocks' });
		expect(screen.queryByRole('textbox', { name: 'Markdown de la fiche' })).toBeNull();
	});
});

describe('Mémoire › Fichiers : localiser, tout replier, tout déplier', () => {
	const arbre = () => screen.getByRole('navigation', { name: 'Fiches' });

	it('« Localiser la fiche ouverte » : désactivé sans fiche ; déplie ses dossiers, efface un filtre qui la masque, la sélectionne et l’amène en vue', async () => {
		const defiler = vi.fn();
		HTMLElement.prototype.scrollIntoView = defiler;
		monter();
		const localiser = await screen.findByRole('button', { name: 'Localiser la fiche ouverte' });
		expect((localiser as HTMLButtonElement).disabled).toBe(true);
		await ouvrirStocks();
		expect((localiser as HTMLButtonElement).disabled).toBe(false);
		fireEvent.click(within(arbre()).getByRole('button', { name: 'erp-saas' }));
		fireEvent.click(within(arbre()).getByRole('button', { name: 'projets' }));
		fireEvent.change(screen.getByPlaceholderText('Filtrer les fichiers'), { target: { value: 'lefevre' } });
		expect(within(arbre()).queryByRole('button', { name: 'Module stocks' })).toBeNull();
		defiler.mockClear();
		await act(async () => fireEvent.click(localiser));
		const fiche = within(arbre()).getByRole('button', { name: 'Module stocks' });
		expect((screen.getByPlaceholderText('Filtrer les fichiers') as HTMLInputElement).value).toBe('');
		expect(fiche.getAttribute('aria-current')).toBe('page');
		expect(document.activeElement).toBe(fiche);
		expect(defiler).toHaveBeenCalledWith({ block: 'nearest' });
	});

	it('« Localiser » amène en vue une fiche au-delà des 400 premières lignes de l’arbre', async () => {
		HTMLElement.prototype.scrollIntoView = vi.fn();
		const fiches = Array.from({ length: 600 }, (_, i) => ficheGraphe(`personnes/P${String(i).padStart(3, '0')}.md`, 0));
		const faux = creerFauxClient({
			'/api/sessions': { sessions: [] },
			'/api/sante': { ok: true, pid: 1, racine: '~/Developer', racineAbsolue: '/Users/ana/Developer', terminaux: { ok: true }, version: '0.1.0' },
			'/api/fil': { commits: [], aConfirmer: [], montees: [], modifications: [] },
			'/api/memoire/graphe': { ...GRAPHE, fiches, liens: [] },
			'/api/memoire/fiche': () => vueStocks({ chemin: 'personnes/P590.md', titre: 'P590' }),
		});
		render(<Application client={faux.client} depart={{ vue: 'memoire', ongletMemoire: 'fichiers' }} />);
		const filtre = screen.getByPlaceholderText('Filtrer les fichiers');
		fireEvent.change(filtre, { target: { value: 'P590' } });
		fireEvent.click(await within(arbre()).findByRole('button', { name: 'P590' }));
		fireEvent.change(filtre, { target: { value: '' } });
		expect(within(arbre()).queryByRole('button', { name: 'P590' })).toBeNull();
		await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Localiser la fiche ouverte' })));
		const fiche = within(arbre()).getByRole('button', { name: 'P590' });
		expect(fiche.getAttribute('aria-current')).toBe('page');
		expect(document.activeElement).toBe(fiche);
		expect(within(arbre()).getAllByRole('button').length).toBeLessThanOrEqual(401);
		// retour au début de l'arbre
		fireEvent.click(within(arbre()).getByRole('button', { name: /Afficher le début/ }));
		expect(within(arbre()).getByRole('button', { name: 'P000' })).toBeTruthy();
	});

	it('⌥L localise quand la vue Mémoire est active ; ignoré ailleurs', async () => {
		monter();
		await ouvrirStocks();
		fireEvent.click(within(arbre()).getByRole('button', { name: 'projets' }));
		expect(within(arbre()).queryByRole('button', { name: 'Module stocks' })).toBeNull();
		let suite = true;
		await act(async () => void (suite = fireEvent.keyDown(document.body, { code: 'KeyL', key: '¬', altKey: true })));
		expect(suite).toBe(false);
		expect(within(arbre()).getByRole('button', { name: 'Module stocks' })).toBeTruthy();
		// vue Sessions : ⌥L n'est pas pris
		fireEvent.click(within(arbre()).getByRole('button', { name: 'projets' }));
		await act(async () => fireEvent.click(within(screen.getByRole('navigation', { name: 'Vues' })).getByRole('button', { name: /Sessions/ })));
		await act(async () => void (suite = fireEvent.keyDown(document.body, { code: 'KeyL', key: '¬', altKey: true })));
		expect(suite).toBe(true);
		const arbreMasque = screen.getByRole('navigation', { name: 'Fiches', hidden: true });
		expect(within(arbreMasque).queryByRole('button', { name: 'Module stocks', hidden: true })).toBeNull();
		expect(within(arbreMasque).getByRole('button', { name: 'projets', hidden: true }).getAttribute('aria-expanded')).toBe('false');
	});

	it('« Tout replier » / « Tout déplier » ; ⌘- et ⌘+ avec le focus dans l’arbre seulement', async () => {
		monter();
		await within(await screen.findByRole('navigation', { name: 'Fiches' })).findByRole('button', { name: 'Module stocks' });
		fireEvent.click(screen.getByRole('button', { name: 'Tout replier' }));
		expect(within(arbre()).getAllByRole('button').map((b) => b.textContent)).toEqual(['consignes', 'personnes', 'projets']);
		fireEvent.click(screen.getByRole('button', { name: 'Tout déplier' }));
		expect(within(arbre()).getByRole('button', { name: 'Module stocks' })).toBeTruthy();
		// hors de l'arbre : ⌘- laissé au navigateur (zoom), l'arbre ne bouge pas
		expect(fireEvent.keyDown(document.body, { key: '-', code: 'Minus', metaKey: true })).toBe(true);
		expect(within(arbre()).getByRole('button', { name: 'Module stocks' })).toBeTruthy();
		const dossier = within(arbre()).getByRole('button', { name: 'projets' });
		dossier.focus();
		expect(fireEvent.keyDown(dossier, { key: '-', code: 'Minus', metaKey: true })).toBe(false);
		expect(within(arbre()).queryByRole('button', { name: 'Module stocks' })).toBeNull();
		expect(fireEvent.keyDown(within(arbre()).getByRole('button', { name: 'projets' }), { key: '+', code: 'Equal', metaKey: true, shiftKey: true })).toBe(false);
		expect(within(arbre()).getByRole('button', { name: 'Module stocks' })).toBeTruthy();
		// dans le champ de filtre : ⌘- reste au navigateur
		const filtre = screen.getByPlaceholderText('Filtrer les fichiers');
		filtre.focus();
		expect(fireEvent.keyDown(filtre, { key: '-', code: 'Minus', metaKey: true })).toBe(true);
		expect(within(arbre()).getByRole('button', { name: 'Module stocks' })).toBeTruthy();
	});
});

describe('Mémoire › Importer la mémoire de Claude Code', () => {
	it('clic : appel du service, état en cours, puis bilan court en toast et détail dépliable', async () => {
		let terminer: (b: BilanAmorceVue) => void = () => {};
		const faux = monter({ amorce: () => new Promise<BilanAmorceVue>((r) => (terminer = r)), onglet: 'archiviste' });
		const bouton = await screen.findByRole('button', { name: 'Importer la mémoire de Claude Code' });
		fireEvent.click(bouton);
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/memoire/amorce', {});
		const enCours = screen.getByRole('button', { name: 'Import en cours…' }) as HTMLButtonElement;
		expect(enCours.disabled).toBe(true);
		await act(async () => terminer(BILAN));
		expect(screen.getByRole('status').textContent).toBe(
			'Mémoire de Claude Code importée : 4 notes nouvelles ou modifiées, 2 CLAUDE.md nouveaux ou modifiés, 2 fiches rattachées à un projet — en attente : l’archiviste n’est pas lancé, 6 à traiter',
		);
		// ses avertissements ne sont qu'au bilan (durable), pas dans la pile
		expect(within(screen.getByRole('list', { name: 'Avertissements' })).queryAllByRole('listitem')).toHaveLength(0);
		const detail = screen.getByText('Bilan de l’import').closest('details')!;
		expect(detail.textContent).toContain('Notes : 3 nouvelles, 1 modifiée, 60 inchangées');
		expect(detail.textContent).toContain('CLAUDE.md des projets : 2 nouveaux, 0 modifié, 5 inchangés');
		expect(detail.textContent).toContain('2 fiches rattachées à un projet');
		expect(detail.textContent).toContain('À traiter : en attente : l’archiviste n’est pas lancé, 6 à traiter');
		expect(detail.textContent).toContain('Avertissement : Passages non indexés pour sources/claude-code/p/CLAUDE.md');
		expect(detail.textContent).toContain('1 secret masqué');
		expect(detail.textContent).toContain('Projets/Mnemo/.claude/settings.local.json — pas un fichier .md');
		expect(screen.getByRole('button', { name: 'Importer la mémoire de Claude Code' })).toBeTruthy();
	});

	it('rien de nouveau : toast court ; erreur : en clair', async () => {
		const vide: BilanAmorceVue = {
			notes: { nouvelles: 0, modifiees: 0, inchangees: 4 },
			instructions: { nouvelles: 0, modifiees: 0, inchangees: 1 },
			rattachees: 0,
			secrets: 0,
			ignores: [],
			fiches: [],
			aTraiter: 0,
			archiviste: 'rien',
			commit: null,
		};
		let reponse: () => unknown = () => vide;
		monter({ amorce: () => reponse(), onglet: 'archiviste' });
		fireEvent.click(await screen.findByRole('button', { name: 'Importer la mémoire de Claude Code' }));
		await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Mémoire de Claude Code : rien de nouveau'));
		// rien de nouveau, mais des fiches attendent encore l'archiviste, qui tourne : la consigne lui est confiée
		reponse = () => ({ ...vide, aTraiter: 3, archiviste: 'confie' });
		fireEvent.click(screen.getByRole('button', { name: 'Importer la mémoire de Claude Code' }));
		await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Mémoire de Claude Code : rien de nouveau — confié à l’archiviste (3 à traiter)'));
		reponse = () => {
			throw new ErreurApi('Mémoire verrouillée par un autre processus.', 503);
		};
		fireEvent.click(screen.getByRole('button', { name: 'Importer la mémoire de Claude Code' }));
		await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Import impossible : Mémoire verrouillée par un autre processus.'));
		expect(screen.getByRole('alert').textContent).toContain('Mémoire verrouillée par un autre processus.');
	});
});
