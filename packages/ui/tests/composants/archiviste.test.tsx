// @vitest-environment happy-dom
import type { SessionVue } from '@mnemo/contrat';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { creerApi, ErreurApi } from '../../src/client/api.ts';
import type { FilVue } from '@mnemo/contrat';
import { Application } from '../../src/composants/Application.tsx';
import { dossiersFaux } from '../aides/dossiers-faux.ts';
import { stockage } from '../aides/stockage.ts';
import { cliquerQuandAffiche, creerFauxClient } from '../aides/faux-client.tsx';

/** Terminaux montés (un par xterm créé) : agrandir ne doit jamais en créer un autre. */
const montages = vi.hoisted(() => ({ n: 0 }));

vi.mock('../../src/terminal/Terminal.tsx', () => ({
	// Comme xterm : le champ de saisie est sous un élément `.xterm` (Échap y va à `claude`, pas à l'interface).
	Terminal: (p: { session: string; actif: boolean; compact: boolean }) => {
		useEffect(() => {
			montages.n++;
		}, []);
		return (
			<div className="xterm">
				<textarea className="xterm-helper-textarea" aria-label={`terminal ${p.session}`} data-actif={String(p.actif)} data-compact={String(p.compact)} readOnly />
			</div>
		);
	},
}));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

const A = (h: number, m: number) => {
	const d = new Date();
	d.setHours(h, m, 0, 0);
	return d.getTime();
};

function session(id: string, e: Partial<SessionVue> = {}): SessionVue {
	return {
		id,
		profil: 'travail',
		dossier: 'erp-saas',
		position: 'projets/erp-saas',
		projet: 'erp-saas',
		objectif: `Objectif ${id}`,
		etat: 'attend',
		creeeMs: 1,
		majMs: 1,
		bilanDemandeMs: null,
		commitDebut: null,
		branche: 'main',
		terminal: true,
		dialogueOuvert: false,
		dossierNonRattache: null, niveauModeles: null,
		...e,
	};
}

const ARCHIVISTE = session('arch', { profil: 'archiviste', dossier: '', objectif: 'Ranger les documents déposés', etat: 'attend' });
const STOCKS = session('stocks', { objectif: 'Refondre le module stocks' });

const FIL: FilVue = {
	commits: [{ hash: 'c1', dateMs: A(9, 12), message: 'mnemo: fait projets/erp-saas/Module stocks.md', fiches: ['projets/erp-saas/Module stocks.md'], session: 'stocks' }],
	tronque: false,
	aConfirmer: [],
	montees: [],
	modifications: [],
};

function monter(sessions: SessionVue[] = [STOCKS, ARCHIVISTE]) {
	const lances: unknown[] = [];
	const faux = creerFauxClient({
		'/api/sessions': (_p: unknown, corps: unknown) => {
			if (corps === undefined) return { sessions };
			lances.push(corps);
			return { session: session('nouvel-arch', { profil: 'archiviste', dossier: '', etat: 'travaille' }) };
		},
		'/api/sante': { ok: true, pid: 1, racine: '~/Developer', racineAbsolue: '/Users/ana/Developer', terminaux: { ok: true }, version: '0.1.0' },
		'/api/memoire/graphe': { coffre: '_mnemo', fiches: [], liens: [], notions: [], sens: { disponible: false, etat: 'absent' }, modifieeMs: 0 },
		'/api/dossiers': dossiersFaux([
			{ chemin: 'erp-saas', git: true, marque: true },
			{ chemin: 'api-facturation', git: true, marque: true },
			'Clients',
			'Clients/.archives',
		]),
		'/api/fil': FIL,
		'/api/memoire/documents': { documents: [], aTraiter: [{ chemin: 'sources/claude-code/n.md', titre: 'Notes', document: null, date: '2026-11-22', aTraiter: true }], totalDocuments: 0, totalATraiter: 1 },
		'/api/depot/traiter': (_p: unknown, corps: unknown) => ({ fiches: (corps as { chemins: string[] }).chemins.map((c) => `sources/${c.split('/').pop()}.md`), archiviste: 'confie' }),
	});
	render(<Application client={faux.client} />);
	const tiroir = document.querySelector<HTMLElement>('aside[data-ouvert][aria-label="Archiviste"]')!;
	return { faux, lances, tiroir };
}

/** Choisit `chemin` (un dossier de premier niveau) dans l'arbre « Destination » du calque de dépôt. */
async function choisirDestination(tiroir: HTMLElement, chemin: string): Promise<void> {
	const destination = within(tiroir).getByRole('group', { name: 'Destination' });
	await cliquerQuandAffiche(within(destination).findByRole('button', { name: new RegExp(`^${chemin}`) }));
	expect(within(destination).getByText(`Destination : ${chemin}`)).toBeTruthy();
}

const altA = () => fireEvent.keyDown(document, { code: 'KeyA', key: 'å', altKey: true });
const altMajA = (cible: Element | Document = document) => fireEvent.keyDown(cible, { code: 'KeyA', key: 'Å', altKey: true, shiftKey: true });

/** Bloc d'une règle d'un module CSS (`.terminal { … }`), tel qu'écrit. */
function regle(fichier: string, selecteur: string): string {
	const css = readFileSync(join(import.meta.dirname, '../../src/composants/archiviste', fichier), 'utf8');
	const debut = css.indexOf(`${selecteur} {`);
	expect(debut).toBeGreaterThanOrEqual(0);
	return css.slice(debut, css.indexOf('}', debut));
}

describe('tiroir de l’archiviste', () => {
	it('⌥A ouvre, focus dans le terminal après 300 ms ; Échap et ⌥A dans le terminal vont à `claude` (tiroir ouvert) ; ⌥A hors terminal ferme et rend le focus', async () => {
		const { tiroir } = monter();
		const memoire = within(screen.getByRole('navigation', { name: 'Vues' })).getByRole('button', { name: /Mémoire/ });
		memoire.focus();
		await act(async () => altA());
		expect(tiroir.getAttribute('data-ouvert')).toBe('true');
		const terminal = await within(tiroir).findByLabelText('terminal arch');
		expect(terminal.getAttribute('data-actif')).toBe('true');
		await waitFor(() => expect(document.activeElement).toBe(terminal), { timeout: 1000 });
		await act(async () => fireEvent.keyDown(terminal, { code: 'Escape', key: 'Escape' }));
		expect(tiroir.getAttribute('data-ouvert')).toBe('true');
		let annulee = false;
		await act(async () => {
			annulee = !fireEvent.keyDown(terminal, { code: 'KeyA', key: 'å', altKey: true });
		});
		expect(annulee).toBe(false);
		expect(tiroir.getAttribute('data-ouvert')).toBe('true');
		terminal.blur();
		await act(async () => altA());
		expect(tiroir.getAttribute('data-ouvert')).toBe('false');
		expect(document.activeElement).toBe(memoire);
	});

	it('Échap depuis un contrôle du tiroir hors terminal ferme et rend le focus à l’élément d’avant', async () => {
		const { tiroir } = monter();
		const memoire = within(screen.getByRole('navigation', { name: 'Vues' })).getByRole('button', { name: /Mémoire/ });
		memoire.focus();
		await act(async () => altA());
		const activite = within(tiroir).getByRole('button', { name: /^Activité/ });
		activite.focus();
		await act(async () => fireEvent.keyDown(activite, { code: 'Escape', key: 'Escape' }));
		expect(tiroir.getAttribute('data-ouvert')).toBe('false');
		expect(document.activeElement).toBe(memoire);
	});

	it('bouton « Archiviste » de la barre de titre l’ouvre, « Fermer » le ferme', async () => {
		const { tiroir } = monter();
		await act(async () => fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: /Archiviste/ })));
		expect(tiroir.getAttribute('data-ouvert')).toBe('true');
		await act(async () => fireEvent.click(within(tiroir).getByRole('button', { name: 'Fermer' })));
		expect(tiroir.getAttribute('data-ouvert')).toBe('false');
	});

	it('tiroir minimal : ni suggestions, ni zone de dépôt visible, ni « Ce qu’il a fait pour tes sessions » ; « N à faire » → Mémoire › Archiviste, tiroir fermé', async () => {
		const { faux, tiroir } = monter();
		await act(async () => altA());
		await within(tiroir).findByLabelText('terminal arch');
		expect(within(tiroir).queryByRole('button', { name: 'Range les documents déposés' })).toBeNull();
		expect(within(tiroir).queryByText('Dépose n\'importe quoi')).toBeNull();
		expect(tiroir.querySelector('[data-depot]')).toBeNull();
		expect(within(tiroir).queryByRole('list', { name: 'Ce qu\'il a fait pour tes sessions' })).toBeNull();
		// le servi d'une session n'est plus dans le tiroir
		await act(async () =>
			faux.connexion.emettre({ type: 'servi', entree: { session: 'stocks', moment: 'message', horodatageMs: A(10, 27), ids: ['a.md'], texte: '', ms: 3, sens: false, classement: [], muet: null, cartes: [] } }),
		);
		expect(within(tiroir).queryByText(/fiche injectée/)).toBeNull();
		// 1 source à traiter, rien à arbitrer
		const aFaire = await within(tiroir).findByRole('button', { name: '1 à faire' });
		await act(async () => fireEvent.click(aFaire));
		expect(tiroir.getAttribute('data-ouvert')).toBe('false');
		expect(screen.getByRole('main').getAttribute('data-vue')).toBe('memoire');
		expect(screen.getByRole('tab', { name: 'Archiviste (1)' }).getAttribute('aria-selected')).toBe('true');
	});

	it('activité minimale : repliée par défaut ; dépliée, les changements de la mémoire du jour ; état gardé', async () => {
		const valeurs = stockage();
		const { tiroir } = monter();
		await act(async () => altA());
		const entete = within(tiroir).getByRole('button', { name: /^Activité \(1\)/ });
		expect(entete.getAttribute('aria-expanded')).toBe('false');
		expect(entete.textContent).toContain('▸');
		expect(tiroir.querySelector('[data-zone="activite"]')).toBeNull();
		await act(async () => fireEvent.click(entete));
		expect(entete.getAttribute('aria-expanded')).toBe('true');
		const defile = tiroir.querySelector<HTMLElement>('[data-zone="activite"]')!;
		expect(regle('TiroirArchiviste.module.css', '.defile')).toMatch(/overflow: auto;/);
		const liste = within(defile).getByRole('list', { name: 'Changements de la mémoire aujourd’hui' });
		expect(within(liste).getAllByRole('listitem')[0]!.textContent).toContain('fait projets/erp-saas/Module stocks.md');
		expect(valeurs.get('mnemo.archiviste.activite.depliee')).toBe('1');
		expect(within(tiroir).getByLabelText('terminal arch')).toBeTruthy();
		cleanup();
		const { tiroir: autre } = monter();
		await act(async () => altA());
		expect(within(autre).getByRole('button', { name: /^Activité/ }).getAttribute('aria-expanded')).toBe('true');
		await act(async () => fireEvent.click(within(autre).getByRole('button', { name: /^Activité/ })));
		expect(valeurs.has('mnemo.archiviste.activite.depliee')).toBe(false);
	});

	it('sans archiviste vivant → « Lancer l’archiviste » → POST sessions, profil `archiviste`', async () => {
		const { faux, lances, tiroir } = monter([STOCKS, session('vieil-arch', { profil: 'archiviste', etat: 'terminee' })]);
		await act(async () => altA());
		expect(within(tiroir).queryByLabelText(/^terminal/)).toBeNull();
		const lancer = within(tiroir).getByRole('button', { name: 'Lancer l\'archiviste' });
		// Après la glissade, le focus est sur « Lancer l'archiviste ».
		await waitFor(() => expect(document.activeElement).toBe(lancer), { timeout: 1000 });
		await act(async () => fireEvent.click(lancer));
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/sessions', { profil: 'archiviste', dossier: '' });
		expect(lances).toHaveLength(1);
		// La session arrive par le WebSocket : son terminal s'affiche.
		await act(async () => faux.connexion.emettre({ type: 'session', session: session('nouvel-arch', { profil: 'archiviste', dossier: '', etat: 'travaille' }) }));
		const terminal = await within(tiroir).findByLabelText('terminal nouvel-arch');
		// Le focus va au nouveau terminal dès qu'il paraît.
		await waitFor(() => expect(document.activeElement).toBe(terminal), { timeout: 1000 });
	});

	it('glisser des fichiers sur le tiroir : un calque de dépôt paraît le temps du glisser ; déposé → `depot` vers le dossier choisi', async () => {
		const { faux, tiroir } = monter();
		await act(async () => altA());
		const terminal = await within(tiroir).findByLabelText('terminal arch');
		// un texte tiré de la page n'ouvre pas le calque
		await act(async () => fireEvent.dragEnter(terminal, { dataTransfer: { types: ['text/plain'], files: [] } }));
		expect(tiroir.querySelector('[data-calque-depot]')).toBeNull();
		await act(async () => fireEvent.dragEnter(terminal, { dataTransfer: { types: ['Files'], files: [] } }));
		const calque = tiroir.querySelector<HTMLElement>('[data-calque-depot]')!;
		expect(within(calque).getByText('Dépose n\'importe quoi')).toBeTruthy();
		// défaut : la racine ; un dossier caché profond est une destination comme une autre
		const destination = within(calque).getByRole('group', { name: 'Destination' });
		expect(within(destination).getByText('Destination : Developer')).toBeTruthy();
		await cliquerQuandAffiche(within(destination).findByRole('button', { name: /^\.archives/ }));
		expect(within(destination).getByText('Destination : Clients/.archives')).toBeTruthy();
		// sorti du tiroir sans déposer : le calque s'en va
		await act(async () => fireEvent.dragLeave(calque, { relatedTarget: null }));
		expect(tiroir.querySelector('[data-calque-depot]')).toBeNull();
		await act(async () => fireEvent.dragEnter(terminal, { dataTransfer: { types: ['Files'], files: [] } }));
		const zone = tiroir.querySelector<HTMLElement>('[data-calque-depot] [data-depot]')!;
		const fichier = new File(['bonjour'], 'mails.mbox', { type: 'application/mbox' });
		await act(async () => fireEvent.drop(zone, { dataTransfer: { files: [fichier], types: ['Files'] } }));
		expect(faux.api.deposer).toHaveBeenCalledWith('mails.mbox', fichier);
		expect(await screen.findByText('Déposé : mails.mbox')).toBeTruthy();
		expect(tiroir.querySelector('[data-calque-depot]')).toBeNull();
	});

	it('un lot de fichiers : chacun déposé, puis une seule consigne pour les déposés (`depotTraiter`), jamais pour un refusé', async () => {
		const { faux, tiroir } = monter();
		faux.api.deposer.mockImplementation(async (vers: string) => {
			if (vers.endsWith('cdc.pdf')) throw new ErreurApi('Le fichier « erp-saas/cdc.pdf » existe déjà : il n\'est jamais remplacé.', 409);
			return { chemin: vers };
		});
		await act(async () => altA());
		const terminal = await within(tiroir).findByLabelText('terminal arch');
		await act(async () => fireEvent.dragEnter(terminal, { dataTransfer: { types: ['Files'], files: [] } }));
		await choisirDestination(tiroir, 'erp-saas');
		const fichiers = ['a.txt', 'cdc.pdf', 'b.eml'].map((nom) => new File(['x'], nom));
		await act(async () => fireEvent.drop(tiroir.querySelector<HTMLElement>('[data-calque-depot] [data-depot]')!, { dataTransfer: { files: fichiers, types: ['Files'] } }));
		expect(faux.api.deposer).toHaveBeenCalledTimes(3);
		const consignes = () => faux.api.envoyer.mock.calls.filter(([chemin]) => chemin === '/api/depot/traiter');
		await waitFor(() => expect(consignes()).toEqual([['/api/depot/traiter', { chemins: ['erp-saas/a.txt', 'erp-saas/b.eml'] }]]));
		expect(await screen.findByText('Déposé : erp-saas/b.eml')).toBeTruthy();
	});

	it('fin de lot en échec : le message le dit, les documents déposés restent déposés (aucun nouvel envoi, rien d’annulé)', async () => {
		const { faux, tiroir } = monter();
		faux.api.envoyer.mockImplementation(async (chemin: string) => {
			if (chemin === '/api/depot/traiter') throw new ErreurApi('Service arrêté', 503);
			return undefined;
		});
		await act(async () => altA());
		const terminal = await within(tiroir).findByLabelText('terminal arch');
		await act(async () => fireEvent.dragEnter(terminal, { dataTransfer: { types: ['Files'], files: [] } }));
		await choisirDestination(tiroir, 'erp-saas');
		await act(async () => fireEvent.drop(tiroir.querySelector<HTMLElement>('[data-calque-depot] [data-depot]')!, { dataTransfer: { files: [new File(['x'], 'a.txt'), new File(['y'], 'b.txt')], types: ['Files'] } }));
		expect(await screen.findByText('Consigne non envoyée à l’archiviste : Service arrêté (les documents restent à traiter)')).toBeTruthy();
		expect(faux.api.deposer.mock.calls.map(([vers]) => vers)).toEqual(['erp-saas/a.txt', 'erp-saas/b.txt']);
		expect(faux.api.envoyer.mock.calls.filter(([chemin]) => chemin === '/api/depot/traiter')).toHaveLength(1);
		expect(faux.api.supprimer).not.toHaveBeenCalled();
	});

	it('lot sans archiviste qui tourne : « à traiter », il les recevra à son lancement', async () => {
		const { faux, tiroir } = monter();
		faux.api.envoyer.mockImplementation(async (chemin: string) => (chemin === '/api/depot/traiter' ? { fiches: ['sources/a.md', 'sources/b.md'], archiviste: 'en_attente' } : undefined));
		await act(async () => altA());
		const terminal = await within(tiroir).findByLabelText('terminal arch');
		await act(async () => fireEvent.dragEnter(terminal, { dataTransfer: { types: ['Files'], files: [] } }));
		await choisirDestination(tiroir, 'erp-saas');
		await act(async () => fireEvent.drop(tiroir.querySelector<HTMLElement>('[data-calque-depot] [data-depot]')!, { dataTransfer: { files: [new File(['x'], 'a.txt'), new File(['y'], 'b.txt')], types: ['Files'] } }));
		expect(await screen.findByText('À traiter : 2 documents, l’archiviste les recevra à son lancement')).toBeTruthy();
	});

	it('dépôt par le calque ; 413 → le message exact du service ; 409 → « … existe déjà », message exact du service', async () => {
		const { faux, tiroir } = monter();
		await act(async () => altA());
		const terminal = await within(tiroir).findByLabelText('terminal arch');
		const deposer = async (f: File) => {
			await act(async () => fireEvent.dragEnter(terminal, { dataTransfer: { types: ['Files'], files: [] } }));
			await choisirDestination(tiroir, 'erp-saas');
			const zone = tiroir.querySelector<HTMLElement>('[data-calque-depot] [data-depot]')!;
			await act(async () => fireEvent.drop(zone, { dataTransfer: { files: [f], types: ['Files'] } }));
		};
		faux.api.deposer.mockRejectedValueOnce(new ErreurApi('Document trop volumineux : « erp-saas/gros.pdf » (plus de 10 Go).', 413));
		const gros = new File(['x'], 'gros.pdf');
		await deposer(gros);
		expect(faux.api.deposer).toHaveBeenCalledWith('erp-saas/gros.pdf', gros);
		expect(await screen.findByText('Dépôt impossible : Document trop volumineux : « erp-saas/gros.pdf » (plus de 10 Go).')).toBeTruthy();
		faux.api.deposer.mockRejectedValueOnce(new ErreurApi('Le fichier « erp-saas/cdc.pdf » existe déjà : il n\'est jamais remplacé.', 409));
		await deposer(new File(['x'], 'cdc.pdf'));
		expect(await screen.findByText('Le fichier « erp-saas/cdc.pdf » existe déjà : il n\'est jamais remplacé.')).toBeTruthy();
	});

	it('gros fichier déjà là : la vérification préalable (sans corps) donne « existe déjà » avant tout envoi', async () => {
		const { faux, tiroir } = monter();
		const envoyes: unknown[] = [];
		// la vraie API : vérification par `fetch`, envoi par une requête qui ne doit jamais partir
		const api = creerApi({
			base: '',
			jeton: 'j',
			fetch: (async () => new Response(JSON.stringify({ erreur: 'Le fichier « erp-saas/boite.mbox » existe déjà : il n\'est jamais remplacé.' }), { status: 409 })) as unknown as typeof fetch,
			surJetonRefuse: () => {},
			requeteEnvoi: () => {
				envoyes.push('envoi');
				throw new Error('aucun envoi attendu');
			},
		});
		faux.api.deposer.mockImplementation(api.deposer);
		await act(async () => altA());
		const terminal = await within(tiroir).findByLabelText('terminal arch');
		await act(async () => fireEvent.dragEnter(terminal, { dataTransfer: { types: ['Files'], files: [] } }));
		await choisirDestination(tiroir, 'erp-saas');
		const gros = new File([new Uint8Array(2 * 1024 * 1024)], 'boite.mbox');
		await act(async () => fireEvent.drop(tiroir.querySelector<HTMLElement>('[data-calque-depot] [data-depot]')!, { dataTransfer: { files: [gros], types: ['Files'] } }));
		expect(await screen.findByText('Le fichier « erp-saas/boite.mbox » existe déjà : il n\'est jamais remplacé.')).toBeTruthy();
		expect(envoyes).toEqual([]);
	});

	it('« Annuler l\'envoi » : le fichier en cours est abandonné, le reste du lot n\'est pas envoyé', async () => {
		const { faux, tiroir } = monter();
		let annule: AbortSignal | undefined;
		faux.api.deposer.mockImplementationOnce(
			(_vers: string, _f: Blob, _p: unknown, signal: AbortSignal) =>
				new Promise((_r, rejeter) => {
					annule = signal;
					signal.addEventListener('abort', () => rejeter(new DOMException('Envoi annulé.', 'AbortError')));
				}),
		);
		await act(async () => altA());
		const terminal = await within(tiroir).findByLabelText('terminal arch');
		await act(async () => fireEvent.dragEnter(terminal, { dataTransfer: { types: ['Files'], files: [] } }));
		await choisirDestination(tiroir, 'erp-saas');
		const gros = new File([new Uint8Array(2 * 1024 * 1024)], 'boite.mbox');
		const suivant = new File(['x'], 'note.txt');
		await act(async () => fireEvent.drop(tiroir.querySelector<HTMLElement>('[data-calque-depot] [data-depot]')!, { dataTransfer: { files: [gros, suivant], types: ['Files'] } }));
		await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Annuler l\'envoi' })));
		expect(annule?.aborted).toBe(true);
		expect(await screen.findByText('Envoi annulé : boite.mbox')).toBeTruthy();
		expect(screen.queryByRole('progressbar')).toBeNull();
		expect(faux.api.deposer).toHaveBeenCalledTimes(1);
	});

	it('nom de fichier dangereux (« / », « \\ », contrôle, bidi) → refusé sans envoi, nom affiché échappé', async () => {
		const { faux, tiroir } = monter();
		await act(async () => altA());
		const terminal = await within(tiroir).findByLabelText('terminal arch');
		const deposer = async (f: File) => {
			await act(async () => fireEvent.dragEnter(terminal, { dataTransfer: { types: ['Files'], files: [] } }));
			await act(async () => fireEvent.drop(tiroir.querySelector<HTMLElement>('[data-calque-depot] [data-depot]')!, { dataTransfer: { files: [f], types: ['Files'] } }));
		};
		await deposer(new File(['x'], 'facture\u202Efdp.exe'));
		expect(await screen.findByText('Nom de fichier refusé : facture\\u202efdp.exe')).toBeTruthy();
		await deposer(new File(['x'], '..\\secret.txt'));
		expect(await screen.findByText('Nom de fichier refusé : ..\\secret.txt')).toBeTruthy();
		expect(faux.api.deposer).not.toHaveBeenCalled();
	});

	it('gros fichier : progression de l\'envoi affichée puis retirée ; au-delà de 10 Go, refus sans envoi qui dit la taille', async () => {
		const { faux, tiroir } = monter();
		await act(async () => altA());
		const terminal = await within(tiroir).findByLabelText('terminal arch');
		const deposer = async (f: File) => {
			await act(async () => fireEvent.dragEnter(terminal, { dataTransfer: { types: ['Files'], files: [] } }));
			await choisirDestination(tiroir, 'erp-saas');
			await act(async () => fireEvent.drop(tiroir.querySelector<HTMLElement>('[data-calque-depot] [data-depot]')!, { dataTransfer: { files: [f], types: ['Files'] } }));
		};
		const enorme = new File(['x'], 'archive.mbox');
		Object.defineProperty(enorme, 'size', { value: 11 * 1024 ** 3 });
		await deposer(enorme);
		expect(await screen.findByText('Fichier trop gros : archive.mbox (11 Go, 10 Go au plus)')).toBeTruthy();
		expect(faux.api.deposer).not.toHaveBeenCalled();

		let finir: (v: { chemin: string }) => void = () => {};
		let progresser: (envoyes: number, total: number) => void = () => {};
		faux.api.deposer.mockImplementationOnce((_vers: string, _f: Blob, surProgression: (envoyes: number, total: number) => void) => {
			progresser = surProgression;
			return new Promise((r) => (finir = r));
		});
		const gros = new File([new Uint8Array(3 * 1024 * 1024)], 'boite.mbox');
		await deposer(gros);
		await act(async () => progresser(1024 * 1024, 3 * 1024 * 1024));
		const barre = (await screen.findByRole('progressbar', { name: 'Envoi de boite.mbox' })) as HTMLProgressElement;
		expect(barre.value).toBe(1024 * 1024);
		expect(barre.max).toBe(3 * 1024 * 1024);
		expect(screen.getByText('Envoi de boite.mbox : 1 Mo / 3 Mo (33 %)')).toBeTruthy();
		await act(async () => finir({ chemin: 'erp-saas/boite.mbox' }));
		expect(await screen.findByText('Déposé : erp-saas/boite.mbox')).toBeTruthy();
		expect(screen.queryByRole('progressbar')).toBeNull();
	});

	it('largeur : 560 px par défaut ; ← élargit, → rétrécit, gardée ; bornée ; double-clic revient au défaut', async () => {
		const valeurs = stockage();
		const { tiroir } = monter();
		await act(async () => altA());
		const poignee = within(tiroir).getByRole('separator', { name: 'Largeur du panneau Archiviste' });
		expect(tiroir.style.width).toBe('560px');
		await act(async () => fireEvent.keyDown(poignee, { key: 'ArrowLeft' }));
		expect(tiroir.style.width).toBe('580px');
		expect(valeurs.get('mnemo.archiviste.largeur')).toBe('580');
		await act(async () => fireEvent.keyDown(poignee, { key: 'ArrowRight', shiftKey: true }));
		expect(tiroir.style.width).toBe('500px');
		await act(async () => fireEvent.keyDown(poignee, { key: 'Home' }));
		expect(tiroir.style.width).toBe('360px');
		await act(async () => fireEvent.keyDown(poignee, { key: 'End' }));
		expect(tiroir.style.width).toBe(`${Math.floor(window.innerWidth * 0.9)}px`);
		await act(async () => fireEvent.doubleClick(poignee));
		expect(tiroir.style.width).toBe('560px');
		expect(valeurs.has('mnemo.archiviste.largeur')).toBe(false);
	});

	it('largeur gardée relue au montage, bornée à 90 % de la fenêtre', () => {
		stockage().set('mnemo.archiviste.largeur', '99999');
		const { tiroir } = monter();
		expect(tiroir.style.width).toBe(`${Math.floor(window.innerWidth * 0.9)}px`);
	});

	it('sans stockage du navigateur : 560 px, et la poignée règle quand même la largeur', async () => {
		vi.stubGlobal('localStorage', undefined);
		const { tiroir } = monter();
		await act(async () => altA());
		expect(tiroir.style.width).toBe('560px');
		await act(async () => fireEvent.keyDown(within(tiroir).getByRole('separator', { name: 'Largeur du panneau Archiviste' }), { key: 'ArrowLeft' }));
		expect(tiroir.style.width).toBe('580px');
	});

	it('archiviste « à relire » (arrêté) : « Reprendre » appelle la reprise', async () => {
		const { faux, tiroir } = monter([STOCKS, { ...ARCHIVISTE, etat: 'a_relire', terminal: false, dialogueOuvert: false }]);
		await act(async () => altA());
		await within(tiroir).findByText('L\'archiviste s\'est arrêté.');
		await act(async () => fireEvent.click(within(tiroir).getByRole('button', { name: 'Reprendre' })));
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/sessions/arch/reprise', undefined);
	});
	it('hauteur : le terminal prend toute la hauteur restante (flex, jamais de hauteur fixe)', async () => {
		const { tiroir } = monter();
		await act(async () => altA());
		const zone = within(tiroir).getByLabelText('terminal arch').closest<HTMLElement>('[data-zone="terminal"]')!;
		expect(zone).not.toBeNull();
		expect(zone.style.height).toBe('');
		const css = regle('CentreArchiviste.module.css', '.terminal');
		expect(css).toMatch(/flex: 1;/);
		expect(css).toMatch(/min-height: 0;/);
		expect(css).not.toMatch(/(^|[^-])height:/);
	});

	it('« Agrandir » : le même terminal en grand (aucun nouveau), focus au terminal ; « Réduire » le rend au tiroir', async () => {
		const { faux, tiroir } = monter();
		await act(async () => altA());
		const terminal = await within(tiroir).findByLabelText('terminal arch');
		const avant = montages.n;
		const abonnements = vi.spyOn(faux.connexion, 'abonner');
		expect(terminal.getAttribute('data-compact')).toBe('true');
		const agrandir = within(tiroir).getByRole('button', { name: 'Agrandir' });
		expect(agrandir.getAttribute('aria-keyshortcuts')).toBe('Alt+Shift+A');
		agrandir.focus();
		await act(async () => fireEvent.click(agrandir));
		expect(tiroir.getAttribute('data-agrandi')).toBe('true');
		expect(within(tiroir).getByLabelText('terminal arch')).toBe(terminal);
		expect(terminal.getAttribute('data-compact')).toBe('false');
		expect(tiroir.style.width).toBe('');
		expect(within(tiroir).queryByRole('separator')).toBeNull();
		expect(tiroir.querySelector('[data-zone="activite"]')).toBeNull();
		await waitFor(() => expect(document.activeElement).toBe(terminal), { timeout: 1000 });
		const reduire = within(tiroir).getByRole('button', { name: 'Réduire' });
		reduire.focus();
		await act(async () => fireEvent.click(reduire));
		expect(tiroir.getAttribute('data-agrandi')).toBe('false');
		expect(tiroir.getAttribute('data-ouvert')).toBe('true');
		expect(tiroir.style.width).toBe('560px');
		expect(within(tiroir).getByLabelText('terminal arch')).toBe(terminal);
		await waitFor(() => expect(document.activeElement).toBe(terminal), { timeout: 1000 });
		expect(montages.n).toBe(avant);
		expect(abonnements).not.toHaveBeenCalled();
	});

	it('⌥⇧A agrandit (tiroir fermé : l’ouvre en grand), Échap hors terminal réduit puis ferme ; Échap et ⌥⇧A dans le terminal vont à `claude`', async () => {
		const { tiroir } = monter();
		await act(async () => altMajA());
		expect(tiroir.getAttribute('data-ouvert')).toBe('true');
		expect(tiroir.getAttribute('data-agrandi')).toBe('true');
		const terminal = await within(tiroir).findByLabelText('terminal arch');
		await act(async () => fireEvent.keyDown(terminal, { code: 'Escape', key: 'Escape' }));
		expect(tiroir.getAttribute('data-agrandi')).toBe('true');
		const reduire = within(tiroir).getByRole('button', { name: 'Réduire' });
		reduire.focus();
		await act(async () => fireEvent.keyDown(reduire, { code: 'Escape', key: 'Escape' }));
		expect(tiroir.getAttribute('data-agrandi')).toBe('false');
		expect(tiroir.getAttribute('data-ouvert')).toBe('true');
		await act(async () => altMajA(terminal));
		expect(tiroir.getAttribute('data-agrandi')).toBe('false');
		await act(async () => altMajA());
		expect(tiroir.getAttribute('data-agrandi')).toBe('true');
		await act(async () => altMajA());
		expect(tiroir.getAttribute('data-agrandi')).toBe('false');
		await act(async () => fireEvent.keyDown(document.body, { code: 'Escape', key: 'Escape' }));
		expect(tiroir.getAttribute('data-ouvert')).toBe('false');
	});

	it('agrandi puis fermé : rouvert, il revient à sa taille de tiroir', async () => {
		const { tiroir } = monter();
		await act(async () => altMajA());
		await act(async () => fireEvent.click(within(tiroir).getByRole('button', { name: 'Fermer' })));
		expect(tiroir.getAttribute('data-ouvert')).toBe('false');
		await act(async () => altA());
		expect(tiroir.getAttribute('data-agrandi')).toBe('false');
	});
});
