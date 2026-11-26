// @vitest-environment happy-dom
import type { DocumentVue, ElementIndexeVue, EntreeServieVue, FilVue, ReponseDocuments, SessionTermineeVue, SessionVue } from '@mnemo/contrat';
import { CHEMINS_LOT_MAX, PARAMETRES_TOUT } from '@mnemo/commun';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErreurApi } from '../../src/client/api.ts';
import { aujourdhui } from '../../src/client/hooks.ts';
import { Application } from '../../src/composants/Application.tsx';
import { EN_COURS_MS } from '../../src/composants/archiviste/SourcesATraiter.tsx';
import { dossiersFaux } from '../aides/dossiers-faux.ts';
import { cliquerQuandAffiche, creerFauxClient, demandeTout } from '../aides/faux-client.tsx';
import { stockage } from '../aides/stockage.ts';

vi.mock('../../src/terminal/Terminal.tsx', () => ({
	Terminal: (p: { session: string; actif: boolean }) => (
		<div className="xterm">
			<textarea className="xterm-helper-textarea" aria-label={`terminal ${p.session}`} data-actif={String(p.actif)} readOnly />
		</div>
	),
}));
// Le graphe (three.js) n'est pas le sujet ici.
vi.mock('../../src/composants/memoire/graphe/Graphe3D.tsx', () => ({ Graphe3D: () => <p>graphe simulé</p> }));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

const AUJOURDHUI = aujourdhui();
const A = (h: number, m: number) => {
	const d = new Date();
	d.setHours(h, m, 0, 0);
	return d.getTime();
};

const SESSION: SessionVue = {
	id: 's-stocks',
	profil: 'travail',
	dossier: 'erp-saas',
	position: 'projets/erp-saas',
	projet: 'erp-saas',
	objectif: 'Refondre le module stocks',
	etat: 'attend',
	creeeMs: 1,
	majMs: 1,
	bilanDemandeMs: null,
	commitDebut: null,
	branche: 'main',
	terminal: true,
	dialogueOuvert: false,
	dossierNonRattache: null, niveauModeles: null,
};
const ARCHIVISTE: SessionVue = { ...SESSION, id: 'arch', profil: 'archiviste', dossier: '', objectif: null, projet: '', position: '' };

const FAIT: ElementIndexeVue = {
	id: 'projets/erp-saas/Module stocks.md#^f-0003',
	chemin: 'projets/erp-saas/Module stocks.md',
	genre: 'fait',
	typeFiche: 'sujet',
	texte: 'La table stock_mouvement passe en lecture seule.',
	contexte: 'Projets › Module stocks',
	statut: 'a_confirmer',
	date: '2026-11-21',
	valideFin: null,
	finIncluse: false,
	confiance: null,
	source: 'session 7f3a',
	typeSource: 'session',
	categorie: 'decision',
	niveau: null,
	portee: null,
	dossierProjet: null,
};

function filInitial(): FilVue {
	return {
		commits: [
			{ hash: 'aaa1111', dateMs: A(9, 12), message: 'mnemo: fait projets/erp-saas/Module stocks.md', fiches: ['projets/erp-saas/Module stocks.md'], session: 's-stocks' },
			{ hash: 'bbb2222', dateMs: A(10, 41), message: 'mnemo: fiche personnes/Inès Roux.md', fiches: ['personnes/Inès Roux.md', 'clients/durand/durand.md'], session: null },
		],
		tronque: false,
		aConfirmer: [FAIT],
		montees: [{ fiche: 'consignes/Tests.md', texte: 'Écrire le test avant de corriger.', niveau: 'toujours', proposition: { niveau: 'toujours', date: '2026-11-22', source: 'session b7d1' } }],
		modifications: [],
	};
}

const NOTES: DocumentVue = { chemin: 'sources/claude-code/x/notes.md', titre: 'Notes de Claude', document: null, date: '2026-11-21', aTraiter: true };
const INSTRUCTIONS: DocumentVue = { chemin: 'sources/claude-code/x/claude.md', titre: 'CLAUDE.md (Projets/x)', document: 'Projets/x/CLAUDE.md', date: '2026-11-20', aTraiter: true };
const CDC: DocumentVue = { chemin: 'sources/cdc-stocks-v2.md', titre: 'Cahier des charges stocks', document: 'erp-saas/docs/cdc-stocks-v2.pdf', date: '2026-11-18', aTraiter: false };

/** Réponse de `documents` dont les listes sont entières (totaux = longueurs), sauf ce qui est donné. */
function reponse(documents: DocumentVue[], aTraiter: DocumentVue[], autres: Partial<Omit<ReponseDocuments, 'documents' | 'aTraiter'>> = {}): ReponseDocuments {
	return { documents, aTraiter, totalDocuments: documents.length, totalATraiter: aTraiter.length, dossiersNonRattaches: [], avertissements: [], ...autres };
}

function documentsInitiaux(): ReponseDocuments {
	return reponse([NOTES, INSTRUCTIONS, CDC], [NOTES, INSTRUCTIONS]);
}

function monter(o: { fil?: FilVue; documents?: ReponseDocuments; tous?: ReponseDocuments; sessions?: SessionVue[]; proposer?: (corps: unknown) => unknown; traiter?: (corps: unknown) => unknown; traiterDossiers?: (corps: unknown) => unknown; nonAffichees?: string[]; plus?: Record<string, unknown> } = {}) {
	let fil = o.fil ?? filInitial();
	let documents = o.documents ?? documentsInitiaux();
	const corps: unknown[] = [];
	const jours: string[] = [];
	const faux = creerFauxClient({
		'/api/sessions': { sessions: o.sessions ?? [SESSION, ARCHIVISTE] },
		'/api/sessions/s-stocks': { session: SESSION },
		'/api/historique': { sessions: [] },
		...o.plus,
		'/api/sante': { ok: true, pid: 1, racine: '~/Developer', racineAbsolue: '/Users/ana/Developer', terminaux: { ok: true }, version: '0.1.0' },
		'/api/memoire/graphe': { coffre: '_mnemo', fiches: [], liens: [], notions: [], sens: { disponible: false, etat: 'absent' }, modifieeMs: 0 },
		'/api/memoire/fiche': (p: Record<string, string> | undefined) => {
			throw new ErreurApi(`Fiche introuvable : « ${p?.['chemin']} ».`, 404);
		},
		'/api/dossiers': dossiersFaux([{ chemin: 'erp-saas', git: true, marque: true }]),
		'/api/depot/traiter': { fiches: ['sources/mails.md'], archiviste: 'confie' },
		'/api/memoire/documents': (params: Record<string, string> | undefined) => structuredClone(demandeTout(params) && o.tous !== undefined ? o.tous : documents),
		'/api/fil': (params: Record<string, string> | undefined) => {
			jours.push(params?.['jour'] ?? '');
			return structuredClone(fil);
		},
		'/api/proposer': (_p: unknown, c: unknown) => {
			corps.push(c);
			if (o.proposer) return o.proposer(c);
			// Le service écrit : le fait n'est plus à confirmer au prochain fil.
			fil = { ...fil, aConfirmer: [] };
			return { statut: 'ecrit' };
		},
		'/api/memoire/sources/traiter': (_p: unknown, c: unknown) => {
			corps.push(c);
			if (o.traiter) return o.traiter(c);
			return { chemins: (c as { chemins: string[] }).chemins, archiviste: 'confie' };
		},
		'/api/memoire/sources/traiter-toutes': (_p: unknown, c: unknown) => {
			const sauf = (c as { sauf: string[] }).sauf;
			const marquees = [...documents.aTraiter.map((d) => d.chemin), ...(o.nonAffichees ?? [])];
			const chemins = marquees.filter((m) => !sauf.includes(m));
			return o.traiter ? o.traiter({ chemins }) : { chemins, archiviste: 'confie' };
		},
		'/api/memoire/dossiers-non-rattaches/traiter': (_p: unknown, c: unknown) => {
			corps.push(c);
			if (o.traiterDossiers) return o.traiterDossiers(c);
			return { chemins: (c as { chemins: string[] }).chemins, archiviste: 'confie' };
		},
		'/api/memoire/sources/marquer-traite': (_p: unknown, c: unknown) => {
			corps.push(c);
			const chemins = (c as { chemins: string[] }).chemins;
			documents = reponse(documents.documents.map((d) => (chemins.includes(d.chemin) ? { ...d, aTraiter: false } : d)), documents.aTraiter.filter((d) => !chemins.includes(d.chemin)), { dossiersNonRattaches: documents.dossiersNonRattaches, avertissements: documents.avertissements });
			return { traites: chemins };
		},
	});
	render(<Application client={faux.client} depart={{ vue: 'memoire' }} />);
	const changerDocuments = (d: ReponseDocuments) => {
		documents = d;
	};
	return { faux, corps, jours, changerDocuments };
}

const nav = () => screen.getByRole('navigation', { name: 'Vues' });
const aFaire = () => screen.getByRole('region', { name: 'À faire' });
const enrichir = () => screen.getByRole('region', { name: 'Enrichir' });
const ligneATraiter = (titre: string) => within(screen.getByRole('list', { name: 'À traiter' })).getByRole('listitem', { name: titre });
const terminaux = () => screen.queryAllByLabelText('terminal arch');

describe('Mémoire › Archiviste : onglets et navigation', () => {
	it('rail : Sessions et Mémoire (Réglages en bas), plus de Fil ; la pastille des éléments à faire est sur Mémoire', async () => {
		monter();
		expect(within(nav()).queryByRole('button', { name: /Fil/ })).toBeNull();
		expect(within(nav()).getAllByRole('button').map((b) => b.textContent?.replace(/\d+$/u, ''))).toEqual(['Sessions', 'Mémoire', 'Réglages']);
		// 1 fait à confirmer + 1 montée + 2 sources à traiter
		await waitFor(() => expect(within(nav()).getByRole('button', { name: /Mémoire/ }).textContent).toContain('4'));
	});

	it('onglets dans l’ordre Archiviste (N) | Fichiers | Graph 3D ; Archiviste ouvert par défaut', async () => {
		monter();
		const onglets = () => within(screen.getByRole('tablist', { name: 'Mémoire' })).getAllByRole('tab');
		await waitFor(() => expect(onglets().map((o) => o.textContent)).toEqual(['Archiviste (4)', 'Fichiers', 'Graph 3D']));
		expect(onglets()[0]!.getAttribute('aria-selected')).toBe('true');
		expect(screen.queryByRole('tab', { name: /Documents/ })).toBeNull();
	});

	it('trois colonnes : À faire, le terminal de l’archiviste et ses suggestions, Enrichir', async () => {
		monter();
		expect(aFaire()).toBeTruthy();
		const centre = screen.getByRole('region', { name: 'Terminal de l’archiviste' });
		expect(await within(centre).findByLabelText('terminal arch')).toBeTruthy();
		expect(within(centre).getByRole('button', { name: 'Range les documents déposés' })).toBeTruthy();
		expect(within(enrichir()).getByText('Déposer n\'importe quoi')).toBeTruthy();
		expect(within(enrichir()).getByRole('group', { name: 'Destination' })).toBeTruthy();
		expect(within(enrichir()).getByRole('button', { name: 'Importer la mémoire de Claude Code' })).toBeTruthy();
	});

	it('rien à faire : « Rien à faire. », aucun groupe ; groupes vides masqués', async () => {
		monter({ fil: { ...filInitial(), aConfirmer: [], montees: [] }, documents: reponse([CDC], []) });
		expect(await within(aFaire()).findByText('Rien à faire.')).toBeTruthy();
		expect(within(aFaire()).queryByRole('region', { name: 'À arbitrer' })).toBeNull();
		expect(within(aFaire()).queryByRole('region', { name: 'À traiter' })).toBeNull();
		cleanup();
		monter({ documents: reponse([CDC], []) });
		expect(await within(aFaire()).findByRole('region', { name: 'À arbitrer' })).toBeTruthy();
		expect(within(aFaire()).queryByRole('region', { name: 'À traiter' })).toBeNull();
		expect(within(aFaire()).queryByText('Rien à faire.')).toBeNull();
	});
});

describe('Mémoire › Archiviste : colonnes redimensionnables', () => {
	afterEach(() => vi.unstubAllGlobals());
	const poignee = (nom: string) => screen.getByRole('separator', { name: nom });
	const largeur = (nom: string, variable: string) => poignee(nom).parentElement!.style.getPropertyValue(variable);

	it('« À faire » : 340 px par défaut ; → élargit, gardée ; double-clic revient au défaut', async () => {
		const valeurs = stockage();
		monter();
		await act(async () => fireEvent.keyDown(poignee('Largeur de la colonne À faire'), { key: 'ArrowRight' }));
		expect(largeur('Largeur de la colonne À faire', '--l-a-faire')).toBe('360px');
		expect(valeurs.get('mnemo.archiviste.largeurAFaire')).toBe('360');
		await act(async () => fireEvent.doubleClick(poignee('Largeur de la colonne À faire')));
		expect(largeur('Largeur de la colonne À faire', '--l-a-faire')).toBe('340px');
		expect(valeurs.has('mnemo.archiviste.largeurAFaire')).toBe(false);
	});

	it('« Enrichir » : 380 px par défaut ; ← élargit (poignée à gauche de la colonne), gardée', async () => {
		const valeurs = stockage();
		monter();
		expect(largeur('Largeur de la colonne Enrichir', '--l-enrichir')).toBe('380px');
		await act(async () => fireEvent.keyDown(poignee('Largeur de la colonne Enrichir'), { key: 'ArrowLeft' }));
		expect(largeur('Largeur de la colonne Enrichir', '--l-enrichir')).toBe('400px');
		expect(valeurs.get('mnemo.archiviste.largeurEnrichir')).toBe('400');
	});

	it('fenêtre étroite : les poignées sont masquées (colonnes empilées)', () => {
		const css = readFileSync(join(import.meta.dirname, '../../src/composants/archiviste/PageArchiviste.module.css'), 'utf8');
		const etroite = css.slice(css.indexOf('@media (max-width: 1100px)'));
		expect(etroite).toMatch(/\.poignee\s*\{\s*display: none;/u);
	});
});

describe('Mémoire › Archiviste : fenêtre étroite', () => {
	/** Règles de la media query « fenêtre étroite » de la page, par sélecteur. */
	function etroite(): Map<string, string> {
		const css = readFileSync(join(import.meta.dirname, '../../src/composants/archiviste/PageArchiviste.module.css'), 'utf8');
		const debut = css.indexOf('@media (max-width: 1100px)');
		expect(debut).toBeGreaterThanOrEqual(0);
		const bloc = css.slice(css.indexOf('{', debut) + 1);
		const regles = new Map<string, string>();
		for (const m of bloc.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) regles.set(m[1]!.trim(), m[2]!);
		return regles;
	}

	it('colonnes empilées : chacune garde la hauteur de son contenu (jamais écrasée sous le terminal), la page défile', () => {
		const r = etroite();
		expect(r.get('.page')).toMatch(/grid-template-columns: minmax\(0, 1fr\);/u);
		expect(r.get('.page')).toMatch(/grid-auto-rows: max-content;/u);
		expect(r.get('.page')).toMatch(/overflow: auto;/u);
		// la règle générale `.page > * { min-height: 0 }` (colonnes qui défilent seules) est levée
		expect(r.get('.page > *')).toMatch(/min-height: auto;/u);
		expect(r.get('.colonne')).toMatch(/overflow: visible;/u);
		expect(r.get('.centre')).toMatch(/min-height: 360px;/u);
	});
});

describe('Mémoire › Archiviste : à traiter', () => {
	it('« Traiter » → `sources/traiter` pour ce document ; la ligne passe « en cours »', async () => {
		const { faux, corps } = monter();
		const ligne = await waitFor(() => ligneATraiter('Notes de Claude'));
		await act(async () => fireEvent.click(within(ligne).getByRole('button', { name: 'Traiter' })));
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/memoire/sources/traiter', { chemins: [NOTES.chemin] });
		expect(corps).toEqual([{ chemins: [NOTES.chemin] }]);
		expect(within(ligne).getByText('en cours')).toBeTruthy();
		expect((within(ligne).getByRole('button', { name: 'Traiter' }) as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByRole('status').textContent).toBe('Confié à l’archiviste');
		// l'autre ligne n'est pas touchée
		expect(within(ligneATraiter('CLAUDE.md (Projets/x)')).queryByText('en cours')).toBeNull();
	});

	it('terminaux indisponibles (`manuel`) : la commande s’affiche avec « Copier », qui la copie', async () => {
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		const commande = "cd '/r' && claude '--resume' 'id' 'Traite la fiche'";
		monter({ traiter: () => ({ chemins: [NOTES.chemin], archiviste: 'manuel', manuel: commande }) });
		const ligne = await waitFor(() => ligneATraiter('Notes de Claude'));
		await act(async () => fireEvent.click(within(ligne).getByRole('button', { name: 'Traiter' })));
		const bloc = await screen.findByRole('group', { name: 'Commande de l’archiviste' });
		expect(within(bloc).getByText(commande)).toBeTruthy();
		await act(async () => fireEvent.click(within(bloc).getByRole('button', { name: 'Copier' })));
		expect(writeText).toHaveBeenCalledWith(commande);
		expect(await screen.findByText('Commande copiée')).toBeTruthy();
	});

	it('après un `manuel`, un nouveau « Traiter » refusé ne laisse pas l’ancienne commande affichée', async () => {
		let reponse: () => unknown = () => ({ chemins: [NOTES.chemin], archiviste: 'manuel', manuel: 'claude --resume id' });
		monter({ traiter: () => reponse() });
		const ligne = await waitFor(() => ligneATraiter('Notes de Claude'));
		await act(async () => fireEvent.click(within(ligne).getByRole('button', { name: 'Traiter' })));
		expect(await screen.findByRole('group', { name: 'Commande de l’archiviste' })).toBeTruthy();
		reponse = () => {
			throw new ErreurApi('Le service s’arrête', 503);
		};
		const autre = ligneATraiter('CLAUDE.md (Projets/x)');
		await act(async () => fireEvent.click(within(autre).getByRole('button', { name: 'Traiter' })));
		expect(await screen.findByText('Traitement impossible : Le service s’arrête')).toBeTruthy();
		expect(screen.queryByRole('group', { name: 'Commande de l’archiviste' })).toBeNull();
	});

	it('archiviste lancé par le service : dit tel quel ; refus → toast, ligne rendue', async () => {
		let reponse: () => unknown = () => ({ chemins: [NOTES.chemin], archiviste: 'lance' });
		monter({ traiter: () => reponse() });
		const ligne = await waitFor(() => ligneATraiter('Notes de Claude'));
		await act(async () => fireEvent.click(within(ligne).getByRole('button', { name: 'Traiter' })));
		expect(screen.getByRole('status').textContent).toBe('Archiviste lancé avec la consigne');
		const autre = ligneATraiter('CLAUDE.md (Projets/x)');
		reponse = () => {
			throw new ErreurApi('Aucune de ces fiches n’est à traiter.', 409);
		};
		await act(async () => fireEvent.click(within(autre).getByRole('button', { name: 'Traiter' })));
		expect(screen.getByRole('status').textContent).toBe('Traitement impossible : Aucune de ces fiches n’est à traiter.');
		expect(within(autre).queryByText('en cours')).toBeNull();
		expect((within(autre).getByRole('button', { name: 'Traiter' }) as HTMLButtonElement).disabled).toBe(false);
	});

	it('« Marquer traité » → `sources/marquer-traite` ; la ligne disparaît, le compteur suit', async () => {
		const { faux } = monter();
		const ligne = await waitFor(() => ligneATraiter('Notes de Claude'));
		await act(async () => fireEvent.click(within(ligne).getByRole('button', { name: 'Marquer traité' })));
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/memoire/sources/marquer-traite', { chemins: [NOTES.chemin] });
		expect(within(screen.getByRole('list', { name: 'À traiter' })).queryByRole('listitem', { name: 'Notes de Claude' })).toBeNull();
		await act(async () => faux.connexion.emettre({ type: 'memoire', modifieeMs: 2 }));
		await waitFor(() => expect(screen.getByRole('tab', { name: /Archiviste/ }).textContent).toBe('Archiviste (3)'));
	});

	it('la liste du service fait foi : une fiche marquée traitée puis remarquée (nouvel import) réapparaît', async () => {
		const { faux, changerDocuments } = monter();
		const ligne = await waitFor(() => ligneATraiter('Notes de Claude'));
		await act(async () => fireEvent.click(within(ligne).getByRole('button', { name: 'Marquer traité' })));
		await act(async () => faux.connexion.emettre({ type: 'memoire', modifieeMs: 2 }));
		await waitFor(() => expect(screen.getByRole('tab', { name: /Archiviste/ }).textContent).toBe('Archiviste (3)'));
		changerDocuments(documentsInitiaux());
		await act(async () => faux.connexion.emettre({ type: 'memoire', modifieeMs: 3 }));
		await waitFor(() => expect(screen.getByRole('tab', { name: /Archiviste/ }).textContent).toBe('Archiviste (4)'));
		expect(await waitFor(() => ligneATraiter('Notes de Claude'))).toBeTruthy();
	});

	it('« en cours » : effacé quand la marque disparaît ; sans nouvelles de l’archiviste au bout du délai, la ligne redevient actionnable', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		try {
			const { faux, changerDocuments } = monter();
			const ligne = await waitFor(() => ligneATraiter('Notes de Claude'));
			await act(async () => fireEvent.click(within(ligne).getByRole('button', { name: 'Traiter' })));
			expect(within(ligne).getByText('en cours')).toBeTruthy();
			await act(async () => vi.advanceTimersByTime(EN_COURS_MS - 1000));
			expect(within(ligneATraiter('Notes de Claude')).getByText('en cours')).toBeTruthy();
			await act(async () => vi.advanceTimersByTime(2000));
			const apres = ligneATraiter('Notes de Claude');
			expect(within(apres).queryByText('en cours')).toBeNull();
			expect((within(apres).getByRole('button', { name: 'Traiter' }) as HTMLButtonElement).disabled).toBe(false);
			// traitée par l'archiviste puis remarquée : elle revient sans « en cours »
			await act(async () => fireEvent.click(within(apres).getByRole('button', { name: 'Traiter' })));
			expect(within(ligneATraiter('Notes de Claude')).getByText('en cours')).toBeTruthy();
			changerDocuments(reponse([INSTRUCTIONS, CDC], [INSTRUCTIONS]));
			await act(async () => faux.connexion.emettre({ type: 'memoire', modifieeMs: 2 }));
			await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Notes de Claude' })).toBeNull());
			changerDocuments(documentsInitiaux());
			await act(async () => faux.connexion.emettre({ type: 'memoire', modifieeMs: 3 }));
			const revenue = await waitFor(() => ligneATraiter('Notes de Claude'));
			expect(within(revenue).queryByText('en cours')).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it('« Tout traiter » : une seule demande pour toutes les lignes ; « Ouvrir » lit la fiche dans Fichiers', async () => {
		const { faux } = monter();
		await waitFor(() => ligneATraiter('Notes de Claude'));
		const groupe = within(aFaire()).getByRole('region', { name: 'À traiter' });
		await act(async () => fireEvent.click(within(groupe).getByRole('button', { name: 'Tout traiter' })));
		// le service traite toutes les fiches marquées : seules les déjà confiées sont nommées (aucune ici)
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/memoire/sources/traiter-toutes', { sauf: [] });
		expect(faux.api.envoyer.mock.calls.filter(([r]) => String(r).startsWith('/api/memoire/sources/traiter'))).toHaveLength(1);
		expect((within(groupe).getByRole('button', { name: 'Tout traiter' }) as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(within(ligneATraiter('Notes de Claude')).getByRole('button', { name: 'Ouvrir' }));
		expect(screen.getByRole('tab', { name: 'Fichiers' }).getAttribute('aria-selected')).toBe('true');
		await waitFor(() => expect(faux.api.lire).toHaveBeenCalledWith('/api/memoire/fiche', { chemin: NOTES.chemin }));
	});

	it('dossier non rattaché : une entrée avec le texte du service, comptée ; « Traiter » → `dossiers-non-rattaches/traiter` ; « Tout traiter » l’envoie aussi', async () => {
		const texte = 'Dossier non rattaché : h1/d1 ; les sessions qui y tournent ne reçoivent ni les consignes, ni les rappels, ni les épisodes, ni les skills d’un projet.';
		const { faux, corps } = monter({ documents: { ...documentsInitiaux(), dossiersNonRattaches: [{ dossier: 'h1/d1', texte }] } });
		const ligne = await waitFor(() => ligneATraiter(texte));
		expect(within(ligne).getByText(texte)).toBeTruthy();
		await waitFor(() => expect(within(nav()).getByRole('button', { name: /Mémoire/ }).textContent).toContain('5'));
		await act(async () => fireEvent.click(within(ligne).getByRole('button', { name: 'Traiter' })));
		expect(corps).toEqual([{ chemins: ['h1/d1'] }]);
		expect(within(ligne).getByText('en cours')).toBeTruthy();
		const groupe = within(aFaire()).getByRole('region', { name: 'À traiter' });
		await act(async () => fireEvent.click(within(groupe).getByRole('button', { name: 'Tout traiter' })));
		// le dossier déjà en cours n'est pas renvoyé ; les fiches partent par leur route
		expect(faux.api.envoyer.mock.calls.filter(([r]) => r === '/api/memoire/dossiers-non-rattaches/traiter')).toHaveLength(1);
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/memoire/sources/traiter-toutes', { sauf: [] });
	});

	it('mode dégradé, « Tout traiter » avec fiches et dossiers : les deux commandes restent affichées, dans l’ordre', async () => {
		const texte = 'Dossier non rattaché : h1/d1 ; texte.';
		monter({
			documents: { ...documentsInitiaux(), dossiersNonRattaches: [{ dossier: 'h1/d1', texte }] },
			traiter: (c) => ({ chemins: (c as { chemins: string[] }).chemins, archiviste: 'manuel', manuel: 'claude fiches' }),
			traiterDossiers: (c) => ({ chemins: (c as { chemins: string[] }).chemins, archiviste: 'manuel', manuel: 'claude dossiers' }),
		});
		await waitFor(() => ligneATraiter(texte));
		const groupe = within(aFaire()).getByRole('region', { name: 'À traiter' });
		await act(async () => fireEvent.click(within(groupe).getByRole('button', { name: 'Tout traiter' })));
		await waitFor(() => expect(within(groupe).getAllByRole('group', { name: 'Commande de l’archiviste' })).toHaveLength(2));
		expect(within(groupe).getAllByRole('group', { name: 'Commande de l’archiviste' }).map((g) => within(g).getByText(/^claude /u).textContent)).toEqual(['claude fiches', 'claude dossiers']);
	});

	it('avertissement seul, rien d’autre : l’avertissement, sans « Rien à faire. » (les dossiers sont inconnus)', async () => {
		monter({ fil: { ...filInitial(), aConfirmer: [], montees: [] }, documents: reponse([CDC], [], { avertissements: ['État des sessions illisible : dossiers non rattachés inconnus (verrou).'] }) });
		expect(await within(aFaire()).findByText(/État des sessions illisible/u)).toBeTruthy();
		expect(within(aFaire()).queryByText('Rien à faire.')).toBeNull();
	});

	it('avertissement du service (état illisible) : affiché au-dessus des groupes, les fiches à traiter restent', async () => {
		const avis = 'État des sessions illisible : dossiers non rattachés inconnus (base occupée).';
		monter({ documents: { ...documentsInitiaux(), avertissements: [avis] } });
		expect((await within(aFaire()).findByRole('note')).textContent).toBe(avis);
		expect(ligneATraiter('Notes de Claude')).toBeTruthy();
	});

	it('documents récents : un document « à traiter » mène à son action (focus sur « Traiter ») ; un document traité ouvre sa fiche', async () => {
		const { faux } = monter();
		const liste = await within(enrichir()).findByRole('list', { name: 'Documents récents' });
		await waitFor(() => expect(within(liste).getAllByRole('listitem')).toHaveLength(3));
		const lignes = within(liste).getAllByRole('listitem');
		expect(lignes.map((l) => l.textContent)).toEqual([expect.stringContaining('Notes de Claude'), expect.stringContaining('CLAUDE.md (Projets/x)'), expect.stringContaining('Cahier des charges stocks')]);
		expect(lignes[0]!.textContent).toContain('à traiter');
		expect(lignes[2]!.textContent).toContain('traité');
		expect(lignes[2]!.textContent).toContain('erp-saas/docs/cdc-stocks-v2.pdf');
		await waitFor(() => ligneATraiter('Notes de Claude'));
		fireEvent.click(within(liste).getByRole('button', { name: /Notes de Claude/ }));
		expect(document.activeElement).toBe(within(ligneATraiter('Notes de Claude')).getByRole('button', { name: 'Traiter' }));
		expect(screen.getByRole('tab', { name: /Archiviste/ }).getAttribute('aria-selected')).toBe('true');
		fireEvent.click(within(liste).getByRole('button', { name: /Cahier des charges stocks/ }));
		expect(screen.getByRole('tab', { name: 'Fichiers' }).getAttribute('aria-selected')).toBe('true');
		await waitFor(() => expect(faux.api.lire).toHaveBeenCalledWith('/api/memoire/fiche', { chemin: CDC.chemin }));
	});
});

describe('Mémoire › Archiviste : listes coupées', () => {
	const lot = (n: number): DocumentVue[] => Array.from({ length: n }, (_, i) => ({ ...NOTES, chemin: `sources/lot/n${i}.md`, titre: `Note ${i}` }));

	it('« Tout traiter » traite toutes les fiches à traiter, même celles que la liste coupée ne montre pas', async () => {
		const { faux } = monter({ documents: reponse([NOTES, CDC], [NOTES], { totalDocuments: 60, totalATraiter: CHEMINS_LOT_MAX + 3 }) });
		const groupe = await within(aFaire()).findByRole('region', { name: 'À traiter' });
		await act(async () => fireEvent.click(within(groupe).getByRole('button', { name: 'Tout traiter' })));
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/memoire/sources/traiter-toutes', { sauf: [] });
	});

	it('« Tout traiter » : les fiches déjà en cours ne sont pas renvoyées ; inactif quand il ne reste rien à lancer, affiché ou non', async () => {
		const nonAffichees = Array.from({ length: CHEMINS_LOT_MAX + 2 }, (_, i) => `sources/lot/n${i}.md`);
		const { faux } = monter({ documents: reponse([NOTES, CDC], [NOTES], { totalDocuments: 60, totalATraiter: CHEMINS_LOT_MAX + 3 }), nonAffichees });
		await waitFor(() => ligneATraiter('Notes de Claude'));
		await act(async () => fireEvent.click(within(ligneATraiter('Notes de Claude')).getByRole('button', { name: 'Traiter' })));
		const groupe = within(aFaire()).getByRole('region', { name: 'À traiter' });
		const toutTraiter = () => within(groupe).getByRole('button', { name: 'Tout traiter' }) as HTMLButtonElement;
		// la seule ligne affichée est en cours, mais d'autres fiches attendent hors de la liste
		expect(toutTraiter().disabled).toBe(false);
		await act(async () => fireEvent.click(toutTraiter()));
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/memoire/sources/traiter-toutes', { sauf: [NOTES.chemin] });
		expect(toutTraiter().disabled).toBe(true);
	});

	it('« Traiter » puis « Tout traiter » avant la réponse : la fiche n’est envoyée qu’une fois', async () => {
		let repondre: (r: unknown) => void = () => {};
		const { faux } = monter({ documents: reponse([NOTES, INSTRUCTIONS], [NOTES, INSTRUCTIONS]), traiter: () => new Promise((r) => (repondre = r)) });
		await waitFor(() => ligneATraiter('Notes de Claude'));
		fireEvent.click(within(ligneATraiter('Notes de Claude')).getByRole('button', { name: 'Traiter' }));
		const groupe = within(aFaire()).getByRole('region', { name: 'À traiter' });
		await act(async () => fireEvent.click(within(groupe).getByRole('button', { name: 'Tout traiter' })));
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/memoire/sources/traiter-toutes', { sauf: [NOTES.chemin] });
		await act(async () => repondre({ chemins: [NOTES.chemin], archiviste: 'confie' }));
	});

	it('« N de plus » sous chaque liste coupée, la puce dit le total ; « Tout voir » demande les listes entières', async () => {
		// une fiche de plus entre les deux lectures : la liste entière et son total viennent de la même réponse
		const tous = reponse(lot(CHEMINS_LOT_MAX + 4), lot(CHEMINS_LOT_MAX + 4));
		const { faux } = monter({ documents: reponse([NOTES, CDC], [NOTES], { totalDocuments: 60, totalATraiter: CHEMINS_LOT_MAX + 3 }), tous });
		const groupe = await within(aFaire()).findByRole('region', { name: 'À traiter' });
		expect(within(groupe).getByText(String(CHEMINS_LOT_MAX + 3))).toBeTruthy();
		expect(within(groupe).getByText(`${CHEMINS_LOT_MAX + 2} de plus`)).toBeTruthy();
		const recents = within(enrichir()).getByRole('region', { name: 'Documents récents' });
		expect(within(recents).getByText('58 de plus')).toBeTruthy();
		await act(async () => fireEvent.click(within(groupe).getByRole('button', { name: 'Tout voir' })));
		await waitFor(() => expect(faux.api.lire).toHaveBeenCalledWith('/api/memoire/documents', PARAMETRES_TOUT));
		await waitFor(() => expect(within(screen.getByRole('list', { name: 'À traiter' })).getAllByRole('listitem')).toHaveLength(CHEMINS_LOT_MAX + 4));
		expect(within(groupe).getByText(String(CHEMINS_LOT_MAX + 4))).toBeTruthy();
		expect(within(groupe).queryByText(/de plus$/u)).toBeNull();

	});
});

describe('Mémoire › Archiviste : à arbitrer', () => {
	const carteDe = async (texte: string) => (await within(await within(aFaire()).findByRole('region', { name: 'À arbitrer' })).findByText(texte)).closest('article') as HTMLElement;

	it('Confirmer → `proposer`, grisée, puis disparaît au `memoire` suivant ; la pastille suit', async () => {
		const { faux, corps } = monter();
		const carte = await carteDe('La table stock_mouvement passe en lecture seule.');
		await waitFor(() => expect(within(nav()).getByRole('button', { name: /Mémoire/ }).textContent).toContain('4'));
		await act(async () => fireEvent.click(within(carte).getByRole('button', { name: 'Confirmer' })));
		expect(corps).toEqual([{ genre: 'confirmer', fiche: 'projets/erp-saas/Module stocks.md', ancre: 'f-0003' }]);
		expect(carte.getAttribute('aria-busy')).toBe('true');
		await act(async () => faux.connexion.emettre({ type: 'memoire', modifieeMs: 2 }));
		await waitFor(() => expect(within(aFaire()).queryByText('La table stock_mouvement passe en lecture seule.')).toBeNull());
		await waitFor(() => expect(within(nav()).getByRole('button', { name: /Mémoire/ }).textContent).toContain('3'));
	});

	it('Modifier : champ prérempli, Enregistrer → fait déclaré qui remplace l’ancien', async () => {
		const { corps } = monter();
		const carte = await carteDe('La table stock_mouvement passe en lecture seule.');
		fireEvent.click(within(carte).getByRole('button', { name: 'Modifier' }));
		const champ = within(carte).getByRole('textbox', { name: 'Correction' }) as HTMLTextAreaElement;
		expect(champ.value).toBe('La table stock_mouvement passe en lecture seule.');
		fireEvent.change(champ, { target: { value: 'La table passe en lecture seule en janvier.' } });
		await act(async () => fireEvent.click(within(carte).getByRole('button', { name: 'Enregistrer' })));
		expect(corps).toEqual([
			{
				genre: 'fait',
				fiche: 'projets/erp-saas/Module stocks.md',
				texte: 'La table passe en lecture seule en janvier.',
				categorie: 'decision',
				nature: 'declare',
				source: { type: 'utilisateur', ref: 'utilisateur' },
				remplace: 'f-0003',
			},
		]);
	});

	it('Modifier un fait à fort enjeu : le service le remet « à confirmer » → l’interface le confirme aussitôt, toast « Modifié »', async () => {
		const { corps } = monter({
			proposer: (c) => ((c as { genre: string }).genre === 'fait' ? { statut: 'ecrit', fiche: FAIT.chemin, ancre: 'f-0009', aConfirmer: true, commit: 'x' } : { statut: 'ecrit', fiche: FAIT.chemin, aConfirmer: false, commit: 'y' }),
		});
		const carte = await carteDe('La table stock_mouvement passe en lecture seule.');
		fireEvent.click(within(carte).getByRole('button', { name: 'Modifier' }));
		fireEvent.change(within(carte).getByRole('textbox', { name: 'Correction' }), { target: { value: 'Montant revu : 6 000 €.' } });
		await act(async () => fireEvent.click(within(carte).getByRole('button', { name: 'Enregistrer' })));
		await waitFor(() => expect(corps).toHaveLength(2));
		expect(corps[1]).toEqual({ genre: 'confirmer', fiche: FAIT.chemin, ancre: 'f-0009' });
		expect(await screen.findByText('Modifié')).toBeTruthy();
	});

	it('Modifier → `doublon` : « Déjà en mémoire sous cette forme », rien d’autre n’est envoyé', async () => {
		const { corps } = monter({ proposer: () => ({ statut: 'doublon', fiche: FAIT.chemin, ancre: 'f-0003' }) });
		const carte = await carteDe('La table stock_mouvement passe en lecture seule.');
		fireEvent.click(within(carte).getByRole('button', { name: 'Modifier' }));
		fireEvent.change(within(carte).getByRole('textbox', { name: 'Correction' }), { target: { value: 'Autre texte.' } });
		await act(async () => fireEvent.click(within(carte).getByRole('button', { name: 'Enregistrer' })));
		expect(await screen.findByText('Déjà en mémoire sous cette forme')).toBeTruthy();
		expect(corps).toHaveLength(1);
		expect(carte.getAttribute('aria-busy')).toBe('false');
	});

	it('montée proposée : Rejeter retire la proposition, Confirmer applique le niveau ; refus du service → toast, carte rendue', async () => {
		const { corps } = monter({
			proposer: () => {
				throw new ErreurApi('Refusé : la consigne a changé.', 400);
			},
		});
		const carte = await carteDe('Écrire le test avant de corriger.');
		expect(within(carte).queryByRole('button', { name: 'Modifier' })).toBeNull();
		await act(async () => fireEvent.click(within(carte).getByRole('button', { name: 'Rejeter' })));
		expect(corps).toEqual([{ genre: 'niveau', fiche: 'consignes/Tests.md', retirerProposition: true, source: { type: 'utilisateur', ref: 'utilisateur' } }]);
		expect(await screen.findByText('Refusé : la consigne a changé.')).toBeTruthy();
		expect(carte.getAttribute('aria-busy')).toBe('false');
		await act(async () => fireEvent.click(within(carte).getByRole('button', { name: 'Confirmer' })));
		expect(corps[1]).toEqual({ genre: 'niveau', fiche: 'consignes/Tests.md', niveau: 'toujours', source: { type: 'utilisateur', ref: 'utilisateur' } });
	});

	it('modification proposée par une session : carte « Modification », Rejeter la retire', async () => {
		const fil: FilVue = {
			...filInitial(),
			aConfirmer: [],
			modifications: [{ fiche: 'consignes/env.md', titre: 'Env', cibles: ['synthese'], changements: ['synthèse : « Ne touche jamais aux .env. » → « Jamais de .env. »'], date: '2026-11-22', source: 'session b7d1' }],
		};
		const { corps } = monter({ fil, proposer: () => ({ statut: 'ecrit', fiche: 'consignes/env.md', aConfirmer: false, commit: 'c1' }) });
		const carte = await carteDe('Modifier synthese');
		const etiquette = within(carte).getByText(/Modification/);
		const niveau = within(await carteDe('Écrire le test avant de corriger.')).getByText(/Niveau/);
		expect(etiquette.className).not.toBe(niveau.className);
		expect(within(carte).getByText(/Jamais de \.env\./)).toBeTruthy();
		await act(async () => fireEvent.click(within(carte).getByRole('button', { name: 'Rejeter' })));
		expect(corps).toEqual([{ genre: 'modification', fiche: 'consignes/env.md', retirerProposition: true, source: { type: 'utilisateur', ref: 'utilisateur' } }]);
		expect(await screen.findByText('Modification rejetée')).toBeTruthy();
	});
});

describe('Mémoire › Archiviste : le terminal, un seul affichage', () => {
	it('page affichée, tiroir fermé : le terminal est dans la page ; ⌥A : il passe au tiroir, la page le dit ; « L’afficher ici » le ramène', async () => {
		monter();
		const centre = screen.getByRole('region', { name: 'Terminal de l’archiviste' });
		await within(centre).findByLabelText('terminal arch');
		expect(terminaux()).toHaveLength(1);
		expect(within(centre).getByLabelText('terminal arch').getAttribute('data-actif')).toBe('true');
		await act(async () => fireEvent.keyDown(document, { code: 'KeyA', key: 'å', altKey: true }));
		const tiroir = document.querySelector<HTMLElement>('aside[aria-label="Archiviste"]')!;
		expect(terminaux()).toHaveLength(1);
		expect(within(tiroir).getByLabelText('terminal arch')).toBeTruthy();
		expect(within(centre).getByText('Le terminal de l’archiviste est ouvert dans le tiroir.')).toBeTruthy();
		await act(async () => fireEvent.click(within(centre).getByRole('button', { name: 'L’afficher ici' })));
		expect(tiroir.getAttribute('data-ouvert')).toBe('false');
		expect(terminaux()).toHaveLength(1);
		expect(within(centre).getByLabelText('terminal arch')).toBeTruthy();
		// une autre vue : la page n'affiche plus rien, le tiroir (déjà vu) reprend le terminal, inactif
		fireEvent.click(within(nav()).getByRole('button', { name: /Sessions/ }));
		expect(terminaux()).toHaveLength(1);
		expect(tiroir.querySelector('textarea[aria-label="terminal arch"]')?.getAttribute('data-actif')).toBe('false');
	});

	it('suggestion → son texte et `\\r` dans le terminal de l’archiviste', async () => {
		const { faux } = monter();
		const centre = screen.getByRole('region', { name: 'Terminal de l’archiviste' });
		await within(centre).findByLabelText('terminal arch');
		fireEvent.click(within(centre).getByRole('button', { name: "Qu'as-tu appris aujourd'hui ?" }));
		expect(faux.connexion.envoyes).toContainEqual({ type: 'entree', session: 'arch', donnees: "Qu'as-tu appris aujourd'hui ?\r" });
	});

	it('sans archiviste : « Lancer l’archiviste », suggestions désactivées', async () => {
		monter({ sessions: [SESSION] });
		const centre = screen.getByRole('region', { name: 'Terminal de l’archiviste' });
		expect(await within(centre).findByRole('button', { name: "Lancer l'archiviste" })).toBeTruthy();
		expect((within(centre).getByRole('button', { name: 'Range les documents déposés' }) as HTMLButtonElement).disabled).toBe(true);
	});
});

describe('Mémoire › Archiviste : appris aujourd’hui', () => {
	it('commits du jour : heure, message, nombre de fiches, puce de la session ; le plus récent choisi et détaillé ; ce qu’il a fait pour les sessions', async () => {
		const { jours } = monter();
		const liste = await within(enrichir()).findByRole('list', { name: 'Commits du jour' });
		const lignes = within(liste).getAllByRole('button');
		expect(lignes).toHaveLength(2);
		expect(lignes[0]!.textContent).toContain('10:41');
		expect(lignes[0]!.textContent).toContain('fiche personnes/Inès Roux.md');
		expect(lignes[0]!.textContent).toContain('2 fiches');
		expect(lignes[1]!.textContent).toContain('Refondre le module stocks');
		expect(lignes[0]!.getAttribute('aria-pressed')).toBe('true');
		expect(jours).toContain(AUJOURDHUI);
		const detail = screen.getByRole('region', { name: 'Commit choisi' });
		expect(within(detail).getByText('mnemo: fiche personnes/Inès Roux.md')).toBeTruthy();
		expect(within(detail).getByText('bbb2222')).toBeTruthy();
		expect(within(enrichir()).getByRole('list', { name: 'Ce qu\'il a fait pour les sessions' })).toBeTruthy();
	});

	it('« Ce qu’il a fait pour les sessions » : les `servi` reçus, plus récents d’abord ; un reclassement met la ligne à jour', async () => {
		const { faux } = monter();
		const activite = within(enrichir()).getByRole('list', { name: 'Ce qu\'il a fait pour les sessions' });
		expect(within(enrichir()).getByText('Rien encore aujourd\'hui.')).toBeTruthy();
		const servi: EntreeServieVue = {
			session: 's-stocks',
			moment: 'message',
			horodatageMs: A(10, 27),
			ids: ['a.md', 'b.md#^f-0001'],
			texte: '',
			ms: 30,
			sens: true,
			classement: [
				{ id: 'b.md', titre: 'Bêta', note: null, servi: true, rang: 1 },
				{ id: 'a.md', titre: 'Alpha', note: null, servi: true, rang: 2 },
			],
			muet: null,
			cartes: [],
		};
		await act(async () => faux.connexion.emettre({ type: 'servi', entree: servi }));
		const lignes = within(activite).getAllByRole('listitem');
		expect(lignes).toHaveLength(1);
		expect(lignes[0]!.textContent).toContain('10:27');
		expect(lignes[0]!.textContent).toContain('Refondre le module stocks');
		expect(lignes[0]!.textContent).toContain('2 fiches injectées, en tête : Bêta');
		const note = (c: EntreeServieVue['classement'][number], n: number) => ({ ...c, note: n });
		await act(async () =>
			faux.connexion.emettre({ type: 'servi', entree: { ...servi, classement: [{ ...note(servi.classement[1]!, 0.91), rang: 1 }, { ...note(servi.classement[0]!, 0.4), rang: 2 }] } }),
		);
		const apres = within(activite).getAllByRole('listitem');
		expect(apres).toHaveLength(1);
		expect(apres[0]!.textContent).toContain('2 fiches injectées, en tête : Alpha (91\u00a0%)');
	});

	it('déposer : « Choisir des fichiers » → `depot` vers le projet choisi, toast « Déposé : … »', async () => {
		const { faux } = monter();
		const destination = within(enrichir()).getByRole('group', { name: 'Destination' });
		await cliquerQuandAffiche(within(destination).findByRole('button', { name: /^erp-saas/ }));
		const fichier = new File(['bonjour'], 'mails.mbox', { type: 'application/mbox' });
		const champ = enrichir().querySelector<HTMLInputElement>('input[type=file]')!;
		await act(async () => fireEvent.change(champ, { target: { files: [fichier] } }));
		expect(faux.api.deposer).toHaveBeenCalledWith('erp-saas/mails.mbox', fichier);
		expect(await screen.findByText('Déposé : erp-saas/mails.mbox')).toBeTruthy();
	});

	it('commit choisi : une fiche ouvre Mémoire › Fichiers, la session ouvre la vue Sessions', async () => {
		monter();
		const liste = await within(enrichir()).findByRole('list', { name: 'Commits du jour' });
		fireEvent.click(within(liste).getAllByRole('button')[1]!);
		fireEvent.click(within(screen.getByRole('region', { name: 'Commit choisi' })).getByRole('button', { name: /^Module stocks/ }));
		expect(screen.getByRole('tab', { name: 'Fichiers' }).getAttribute('aria-selected')).toBe('true');
		fireEvent.click(screen.getByRole('tab', { name: /Archiviste/ }));
		fireEvent.click(within(screen.getByRole('region', { name: 'Commit choisi' })).getByRole('button', { name: /Refondre le module stocks/ }));
		await waitFor(() => expect(within(nav()).getByRole('button', { name: /Sessions/ }).getAttribute('aria-current')).toBe('page'));
	});

	it('commit d’une session terminée avant l’ouverture de la page : nommée par son objectif, lu dans l’historique', async () => {
		const ancienne: SessionTermineeVue = { ...SESSION, id: 's-ancienne', objectif: 'Migration des stocks', etat: 'terminee', episode: null };
		const fil = filInitial();
		fil.commits[0] = { ...fil.commits[0]!, session: ancienne.id };
		monter({ fil, plus: { '/api/historique': { sessions: [ancienne] } } });
		const liste = await within(enrichir()).findByRole('list', { name: 'Commits du jour' });
		expect(await within(liste).findByText('Migration des stocks')).toBeTruthy();
		expect(within(liste).queryByText(/^session s-an/)).toBeNull();
	});

	it('commit écrit par l’archiviste : « Écrit par » ouvre son tiroir, comme toute session', async () => {
		const fil = filInitial();
		fil.commits[0] = { ...fil.commits[0]!, session: ARCHIVISTE.id };
		monter({ fil, plus: { '/api/sessions/arch': { session: ARCHIVISTE } } });
		const liste = await within(enrichir()).findByRole('list', { name: 'Commits du jour' });
		fireEvent.click(within(liste).getAllByRole('button')[1]!);
		fireEvent.click(within(screen.getByRole('region', { name: 'Commit choisi' })).getByRole('button', { name: /Archiviste/ }));
		await waitFor(() => expect(screen.getByRole('complementary', { name: 'Archiviste' }).getAttribute('data-ouvert')).toBe('true'));
	});

	it('sélecteur de jour : aujourd’hui par défaut, un autre jour relit le fil de ce jour ; tronqué → avis ; sans commit → message', async () => {
		const { jours } = monter({ fil: { ...filInitial(), tronque: true } });
		const jour = (await screen.findByLabelText('Jour')) as HTMLInputElement;
		expect(jour.type).toBe('date');
		expect(jour.value).toBe(AUJOURDHUI);
		expect(await screen.findByText('Plus de 500 changements ce jour-là : seuls les plus récents sont affichés')).toBeTruthy();
		fireEvent.change(jour, { target: { value: '2026-11-20' } });
		await waitFor(() => expect(jours).toContain('2026-11-20'));
		cleanup();
		monter({ fil: { ...filInitial(), commits: [] } });
		expect(await screen.findByText(/Aucun changement/)).toBeTruthy();
	});

	it('minuit passé : le jour « aujourd’hui » suit la nouvelle date', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 10, 22, 23, 59, 50) });
		try {
			const { jours } = monter();
			const jour = (await screen.findByLabelText('Jour')) as HTMLInputElement;
			expect(jour.value).toBe('2026-11-22');
			await act(async () => vi.advanceTimersByTime(15_000));
			await waitFor(() => expect(jour.value).toBe('2026-11-23'));
			expect(jour.max).toBe('2026-11-23');
			await waitFor(() => expect(jours).toContain('2026-11-23'));
		} finally {
			vi.useRealTimers();
		}
	});
});
