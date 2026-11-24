// @vitest-environment happy-dom
import type { FilVue, LotVue, ReponseDocuments, SessionVue } from '@mnemo/contrat';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErreurApi } from '../../src/client/api.ts';
import { Application } from '../../src/composants/Application.tsx';
import { FICHE_CHANGEE } from '../../src/composants/archiviste/LotAValider.tsx';
import { dossiersFaux } from '../aides/dossiers-faux.ts';
import { creerFauxClient } from '../aides/faux-client.tsx';

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

const ARCHIVISTE: SessionVue = {
	id: 'arch',
	profil: 'archiviste',
	dossier: '',
	position: '',
	projet: '',
	objectif: null,
	etat: 'attend',
	creeeMs: 1,
	majMs: 1,
	bilanDemandeMs: null,
	commitDebut: null,
	branche: 'main',
	terminal: true,
	dialogueOuvert: false,
	dossierNonRattache: null,
};

const FIL_VIDE: FilVue = { commits: [], tronque: false, aConfirmer: [], montees: [], modifications: [] };
const DOCUMENTS_VIDES: ReponseDocuments = { documents: [], aTraiter: [], totalDocuments: 0, totalATraiter: 0, dossiersNonRattaches: [], avertissements: [] };

const ligne = (ancre: string, texte: string, confiance = 80, src = '[[sources/cr]]') => `- [decision] ${texte} | observe | src: ${src} | appris 2026-11-20 | confiance ${confiance} % ^${ancre}`;

/** Quatre doublons en trois lignes : la deuxième en absorbe deux. */
const DOUBLONS: LotVue = {
	id: 'lot-1',
	genre: 'fusionner',
	fiche: 'projets/erp-saas/Module stocks.md',
	titre: 'Module stocks',
	motif: 'Quatre informations répètent une information déjà écrite.',
	proposeMs: 1,
	session: 'arch',
	perime: false,
	lignes: [
		{
			indice: 0,
			ligne: { garder: 'f-0001', absorber: ['f-0006'] },
			avant: [
				{ ancre: 'f-0001', lignes: [ligne('f-0001', 'Les lots sont portés par une table stock_lot.', 30)] },
				{ ancre: 'f-0006', lignes: [ligne('f-0006', 'Une table stock_lot porte les lots.', 30, '[[sources/cdc]]')] },
			],
			apres: { ancre: 'f-0001', lignes: [ligne('f-0001', 'Les lots sont portés par une table stock_lot.', 51), '  + src: [[sources/cdc]] | corroboré 2026-11-24'] },
			motif: null,
		},
		{
			indice: 1,
			ligne: { garder: 'f-0002', absorber: ['f-0007', 'f-0009'] },
			avant: [
				{ ancre: 'f-0002', lignes: [ligne('f-0002', 'Livraison au 15/12/2026.')] },
				{ ancre: 'f-0007', lignes: [ligne('f-0007', 'Livré le 15 décembre 2026.')] },
				{ ancre: 'f-0009', lignes: [ligne('f-0009', 'Livraison mi-décembre.')] },
			],
			apres: { ancre: 'f-0002', lignes: [ligne('f-0002', 'Livraison au 15/12/2026.')] },
			motif: null,
		},
		{
			indice: 2,
			ligne: { garder: 'f-0005', absorber: ['f-0008'] },
			avant: [
				{ ancre: 'f-0005', lignes: [ligne('f-0005', 'Inventaire tournant reporté.')] },
				{ ancre: 'f-0008', lignes: [ligne('f-0008', 'Inventaire tournant plus tard.')] },
			],
			apres: { ancre: 'f-0005', lignes: [ligne('f-0005', 'Inventaire tournant reporté.')] },
			motif: null,
		},
	],
};

const SUPPRESSION: LotVue = {
	...DOUBLONS,
	id: 'lot-2',
	genre: 'supprimer',
	fiche: 'projets/api-facturation/Dépôt SFTP.md',
	titre: null,
	motif: 'Note de travail.',
	lignes: [{ indice: 0, ligne: { ancre: 'f-0002' }, avant: [{ ancre: 'f-0002', lignes: [ligne('f-0002', 'Relancer le test.')] }], apres: null, motif: null }],
};

function monter(o: { lots?: LotVue[]; valider?: (corps: unknown) => unknown; rejeter?: (corps: unknown) => unknown } = {}) {
	let lots = o.lots ?? [DOUBLONS];
	const envois: { route: string; corps: unknown }[] = [];
	const faux = creerFauxClient({
		'/api/sessions': { sessions: [ARCHIVISTE] },
		'/api/historique': { sessions: [] },
		'/api/sante': { ok: true, pid: 1, racine: '~/Developer', racineAbsolue: '/Users/ana/Developer', terminaux: { ok: true }, version: '0.1.0' },
		'/api/memoire/graphe': { coffre: '_mnemo', fiches: [], liens: [], notions: [], sens: { disponible: false, etat: 'absent' }, modifieeMs: 0 },
		'/api/dossiers': dossiersFaux([{ chemin: 'erp-saas', git: true, marque: true }]),
		'/api/memoire/documents': DOCUMENTS_VIDES,
		'/api/fil': FIL_VIDE,
		'/api/lots': () => ({ lots: structuredClone(lots) }),
		'/api/lots/lot-1/valider': (_p: unknown, corps: unknown) => {
			envois.push({ route: 'valider', corps });
			if (o.valider) return o.valider(corps);
			// comme le service : le lot validé n'est plus en attente
			lots = lots.filter((l) => l.id !== 'lot-1');
			return { id: 'lot-1', fiche: DOUBLONS.fiche, commit: 'c1', lignes: (corps as { lignes: number[] }).lignes, changements: [] };
		},
		'/api/lots/lot-1/rejeter': (_p: unknown, corps: unknown) => {
			envois.push({ route: 'rejeter', corps });
			if (o.rejeter) return o.rejeter(corps);
			lots = lots.filter((l) => l.id !== 'lot-1');
			return { id: 'lot-1' };
		},
	});
	render(<Application client={faux.client} depart={{ vue: 'memoire' }} />);
	const changerLots = (l: LotVue[]) => {
		lots = l;
	};
	return { faux, envois, changerLots };
}

const aArbitrer = () => screen.findByRole('region', { name: 'À arbitrer' });
const carteDuLot = async (intitule: string) => within(await aArbitrer()).findByRole('article', { name: intitule });
const lireLots = (faux: ReturnType<typeof monter>['faux']) => faux.api.lire.mock.calls.filter(([chemin]) => chemin === '/api/lots').length;

describe('Mémoire › Archiviste : lots d’informations à valider', () => {
	it('un lot : « 4 doublons proposés dans <titre> » (les absorbées), son motif, Tout valider / Revoir / Rejeter ; compté dans « À arbitrer » et la pastille', async () => {
		monter({ lots: [DOUBLONS, SUPPRESSION] });
		const carte = await carteDuLot('4 doublons proposés dans Module stocks');
		expect(within(carte).getByText('Doublons | Module stocks')).toBeTruthy();
		expect(within(carte).getByText('Quatre informations répètent une information déjà écrite.')).toBeTruthy();
		expect(within(carte).getAllByRole('button').map((b) => b.textContent)).toEqual(['Tout valider', 'Revoir', 'Rejeter']);
		// sans titre lu par le service : le titre tiré du chemin
		expect(await carteDuLot('1 suppression proposée dans Dépôt SFTP')).toBeTruthy();
		expect(within(await aArbitrer()).getByText('2')).toBeTruthy();
		const nav = screen.getByRole('navigation', { name: 'Vues' });
		await waitFor(() => expect(within(nav).getByRole('button', { name: /Mémoire/ }).textContent).toContain('2'));
		// les lignes restent repliées tant qu'on ne revoit pas
		expect(within(carte).queryByRole('checkbox')).toBeNull();
	});

	it('« Tout valider » envoie toutes les lignes ; toast ; le lot relu disparaît', async () => {
		const { envois } = monter();
		const carte = await carteDuLot('4 doublons proposés dans Module stocks');
		await act(async () => fireEvent.click(within(carte).getByRole('button', { name: 'Tout valider' })));
		expect(envois).toEqual([{ route: 'valider', corps: { lignes: [0, 1, 2] } }]);
		expect(await screen.findByText('Lot validé : 3 lignes appliquées')).toBeTruthy();
		await waitFor(() => expect(screen.queryByRole('article', { name: '4 doublons proposés dans Module stocks' })).toBeNull());
	});

	it('pendant l’envoi, le lot est grisé et ses boutons inactifs', async () => {
		let repondre: (r: unknown) => void = () => {};
		monter({ valider: () => new Promise((r) => (repondre = r)) });
		const carte = await carteDuLot('4 doublons proposés dans Module stocks');
		await act(async () => fireEvent.click(within(carte).getByRole('button', { name: 'Tout valider' })));
		expect(carte.getAttribute('aria-busy')).toBe('true');
		expect((within(carte).getByRole('button', { name: 'Rejeter' }) as HTMLButtonElement).disabled).toBe(true);
		await act(async () => repondre({ id: 'lot-1', fiche: DOUBLONS.fiche, commit: 'c1', lignes: [0, 1, 2], changements: [] }));
		expect(await screen.findByText('Lot validé : 3 lignes appliquées')).toBeTruthy();
	});

	it('« Revoir » : une ligne par information (case, catégorie, énoncé), ce qui change en une ligne, l’écrit sous « Détail »', async () => {
		monter();
		const carte = await carteDuLot('4 doublons proposés dans Module stocks');
		const revoir = within(carte).getByRole('button', { name: 'Revoir' });
		fireEvent.click(revoir);
		expect(revoir.getAttribute('aria-expanded')).toBe('true');
		expect(within(carte).getByRole('button', { name: 'Replier' })).toBe(revoir);
		const cases = within(carte).getAllByRole('checkbox') as HTMLInputElement[];
		expect(cases.map((c) => c.getAttribute('aria-labelledby') && document.getElementById(c.getAttribute('aria-labelledby')!)?.textContent)).toEqual([
			'Les lots sont portés par une table stock_lot.',
			'Livraison au 15/12/2026.',
			'Inventaire tournant reporté.',
		]);
		expect(cases.every((c) => c.checked)).toBe(true);
		// la catégorie en puce, hors du nom de la case
		expect(within(carte).getAllByText('decision')).toHaveLength(3);
		const changements = [...carte.querySelectorAll('.changement')].map((e) => e.textContent);
		expect(changements).toEqual([
			'+ source sources/cdc · confiance 30 % → 51 %',
			'absorbe : « Une table stock_lot porte les lots. »',
			'aucune source nouvelle',
			'absorbe : « Livré le 15 décembre 2026. », « Livraison mi-décembre. »',
			'aucune source nouvelle',
			'absorbe : « Inventaire tournant plus tard. »',
		]);
		// la source versée est un lien `[[…]]` (ici absent du graphe)
		expect(within(carte).getByRole('button', { name: 'sources/cdc' })).toBeTruthy();
		// les lignes écrites, seulement sous « Détail »
		const details = carte.querySelectorAll('details');
		expect(details).toHaveLength(3);
		expect([...details].every((d) => !d.open)).toBe(true);
		expect(details[0]!.querySelector('summary')!.textContent).toBe('Détail');
		expect(details[0]!.textContent).toContain('+ src: [[sources/cdc]] | corroboré 2026-11-24');
		const visible = carte.cloneNode(true) as HTMLElement;
		for (const d of visible.querySelectorAll('details')) d.remove();
		expect(visible.textContent).not.toContain('^f-');
		expect(visible.textContent).not.toContain('| observe |');
	});

	it('« Revoir » : décocher une ligne → « Valider N doublons » n’envoie que les cochées', async () => {
		const { envois } = monter();
		const carte = await carteDuLot('4 doublons proposés dans Module stocks');
		fireEvent.click(within(carte).getByRole('button', { name: 'Revoir' }));
		expect(within(carte).getByRole('button', { name: 'Valider 4 doublons' })).toBeTruthy();
		const deuxieme = within(carte).getByRole('checkbox', { name: 'Livraison au 15/12/2026.' }) as HTMLInputElement;
		fireEvent.click(deuxieme);
		expect(deuxieme.checked).toBe(false);
		// la deuxième ligne en absorbait deux
		await act(async () => fireEvent.click(within(carte).getByRole('button', { name: 'Valider 2 doublons' })));
		expect(envois).toEqual([{ route: 'valider', corps: { lignes: [0, 2] } }]);
		expect(await screen.findByText('Lot validé : 2 lignes appliquées')).toBeTruthy();
	});

	it('« Revoir » d’une suppression : « supprimée », « Valider 1 ligne »', async () => {
		monter({ lots: [SUPPRESSION] });
		const carte = await carteDuLot('1 suppression proposée dans Dépôt SFTP');
		fireEvent.click(within(carte).getByRole('button', { name: 'Revoir' }));
		expect([...carte.querySelectorAll('.changement')].map((e) => e.textContent)).toEqual(['supprimée']);
		expect(within(carte).getByRole('button', { name: 'Valider 1 ligne' })).toBeTruthy();
	});

	it('« Revoir » : tout décoché → « Valider » inactif', async () => {
		monter();
		const carte = await carteDuLot('4 doublons proposés dans Module stocks');
		fireEvent.click(within(carte).getByRole('button', { name: 'Revoir' }));
		for (const c of within(carte).getAllByRole('checkbox')) fireEvent.click(c);
		expect((within(carte).getByRole('button', { name: 'Valider 0 doublons' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('lot reproposé (autre date de proposition) : les cases repartent cochées', async () => {
		const { faux, changerLots } = monter();
		const carte = await carteDuLot('4 doublons proposés dans Module stocks');
		fireEvent.click(within(carte).getByRole('button', { name: 'Revoir' }));
		fireEvent.click(within(carte).getByRole('checkbox', { name: 'Livraison au 15/12/2026.' }));
		changerLots([{ ...DOUBLONS, proposeMs: 2 }]);
		await act(async () => faux.connexion.emettre({ type: 'lots', version: '2' }));
		await waitFor(() => expect(within(screen.getByRole('article', { name: '4 doublons proposés dans Module stocks' })).queryByRole('checkbox')).toBeNull());
		const nouvelle = screen.getByRole('article', { name: '4 doublons proposés dans Module stocks' });
		fireEvent.click(within(nouvelle).getByRole('button', { name: 'Revoir' }));
		expect((within(nouvelle).getAllByRole('checkbox') as HTMLInputElement[]).every((c) => c.checked)).toBe(true);
	});

	it('« Rejeter » → `lotRejeter`, toast « Lot rejeté »', async () => {
		const { envois } = monter();
		const carte = await carteDuLot('4 doublons proposés dans Module stocks');
		await act(async () => fireEvent.click(within(carte).getByRole('button', { name: 'Rejeter' })));
		expect(envois).toEqual([{ route: 'rejeter', corps: {} }]);
		expect(await screen.findByText('Lot rejeté')).toBeTruthy();
		await waitFor(() => expect(screen.queryByRole('article', { name: '4 doublons proposés dans Module stocks' })).toBeNull());
	});

	it('refus 409 : toast « la fiche a changé », lot rendu actionnable et relu', async () => {
		const { faux } = monter({
			valider: () => {
				throw new ErreurApi('La fiche a changé.', 409);
			},
		});
		const carte = await carteDuLot('4 doublons proposés dans Module stocks');
		const avant = lireLots(faux);
		await act(async () => fireEvent.click(within(carte).getByRole('button', { name: 'Tout valider' })));
		expect(await screen.findByText(FICHE_CHANGEE)).toBeTruthy();
		expect(FICHE_CHANGEE).toMatch(/la fiche a changé/i);
		expect(carte.getAttribute('aria-busy')).toBe('false');
		await waitFor(() => expect(lireLots(faux)).toBeGreaterThan(avant));
	});

	it('refus 400 : le message du service en toast', async () => {
		monter({
			valider: () => {
				throw new ErreurApi('Refusé : tranche d’abord cette contradiction.', 400);
			},
		});
		const carte = await carteDuLot('4 doublons proposés dans Module stocks');
		await act(async () => fireEvent.click(within(carte).getByRole('button', { name: 'Tout valider' })));
		expect(await screen.findByText('Refusé : tranche d’abord cette contradiction.')).toBeTruthy();
	});

	it('lot périmé : dit, « Tout valider » inactif, « Rejeter » possible', async () => {
		monter({ lots: [{ ...DOUBLONS, perime: true }] });
		const carte = await carteDuLot('4 doublons proposés dans Module stocks');
		expect(within(carte).getByRole('note').textContent).toMatch(/La fiche a changé/);
		expect((within(carte).getByRole('button', { name: 'Tout valider' }) as HTMLButtonElement).disabled).toBe(true);
		expect((within(carte).getByRole('button', { name: 'Rejeter' }) as HTMLButtonElement).disabled).toBe(false);
		// ses lignes ne se cochent pas
		fireEvent.click(within(carte).getByRole('button', { name: 'Revoir' }));
		expect((within(carte).getAllByRole('checkbox') as HTMLInputElement[]).every((c) => c.disabled)).toBe(true);
	});

	it('message `lots` du WebSocket : les lots sont relus, un nouveau lot paraît', async () => {
		const { faux, changerLots } = monter({ lots: [] });
		expect(await screen.findByText('Rien à faire.')).toBeTruthy();
		changerLots([DOUBLONS]);
		await act(async () => faux.connexion.emettre({ type: 'lots', version: '1' }));
		expect(await carteDuLot('4 doublons proposés dans Module stocks')).toBeTruthy();
		expect(screen.queryByText('Rien à faire.')).toBeNull();
	});
});
