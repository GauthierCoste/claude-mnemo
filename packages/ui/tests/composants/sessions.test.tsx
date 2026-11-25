// @vitest-environment happy-dom
import { MINIMUM_COLONNE, MINIMUM_LIGNE } from '../../src/sessions/grille.ts';
import { FICHIERS_GIT_MAX, OBJECTIF_MAX, PROFIL_ARCHIVISTE, PROFIL_TRAVAIL } from '@mnemo/commun';
import type { EntreeServieVue, SessionVue } from '@mnemo/contrat';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErreurApi } from '../../src/client/api.ts';
import { Application } from '../../src/composants/Application.tsx';
import { dossiersFaux } from '../aides/dossiers-faux.ts';
import { cliquerQuandAffiche, creerFauxClient, demandeTout } from '../aides/faux-client.tsx';

// Terminal simulé : un champ qui reçoit le focus comme celui d'xterm.
vi.mock('../../src/terminal/Terminal.tsx', () => ({
	Terminal: (p: { session: string; actif: boolean; compact: boolean }) => (
		<textarea className="xterm-helper-textarea" aria-label={`terminal ${p.session}`} data-actif={String(p.actif)} data-compact={String(p.compact)} readOnly />
	),
}));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

const MAINTENANT = Date.now();

function session(id: string, dossier: string, rang: number, e: Partial<SessionVue> = {}): SessionVue {
	return {
		id,
		profil: PROFIL_TRAVAIL,
		dossier,
		position: `projets/${dossier}`,
		projet: dossier,
		objectif: `Objectif ${id}`,
		etat: 'travaille',
		creeeMs: MAINTENANT - (100 - rang) * 60_000,
		majMs: MAINTENANT,
		bilanDemandeMs: null,
		commitDebut: null,
		branche: 'main',
		terminal: true,
		dialogueOuvert: false,
		dossierNonRattache: null, niveauModeles: null,
		...e,
	};
}

const SESSIONS = [
	session('s1', 'erp-saas', 1, { etat: 'attend' }),
	session('s2', 'erp-saas', 2),
	session('s3', 'api', 3, { etat: 'en_pause' }),
	session('s4', 'agent', 4, { terminal: false, etat: 'en_pause' }),
	session('arch', '', 0, { profil: 'archiviste' }),
];

const CLASSEMENT: EntreeServieVue['classement'] = [
	{ id: 'consignes/Tests.md', titre: 'Tests avant tout', note: 0.92, servi: true, rang: 1 },
	{ id: 'projets/erp-saas/Lots.md', titre: 'Lots et péremption', note: 0.4, servi: false, rang: 2 },
];

const SERVIS: EntreeServieVue[] = [
	{ session: 's1', moment: 'debut', horodatageMs: 1, ids: ['projets/erp-saas/Module stocks.md'], texte: '', ms: 3, sens: true, classement: [], muet: null, cartes: [] },
	{ session: 's1', moment: 'message', horodatageMs: 2, ids: ['consignes/Tests.md#f-0001', 'projets/erp-saas/Module stocks.md'], texte: '', ms: 3, sens: true, classement: CLASSEMENT, muet: null, cartes: [] },
];

const PROFILS = {
	profils: [
		{ nom: PROFIL_ARCHIVISTE, description: 'Tu es l’archiviste de cette mémoire.', lancement: 'memoire', lanceur: 'propre', avatar: { forme: 'chouette', couleur: 'violet' }, personnalise: false },
		{ nom: 'notes', description: 'Range mes notes.', lancement: 'memoire', lanceur: 'dialogue', avatar: { forme: 'goutte', couleur: 'bleu' }, personnalise: true },
		{ nom: 'redaction', description: 'Rédige les courriers.', lancement: 'projet', lanceur: 'dialogue', avatar: { forme: 'renard', couleur: 'ambre' }, personnalise: true },
		{ nom: PROFIL_TRAVAIL, description: 'La mémoire Mnemo est ta mémoire de référence.', lancement: 'projet', lanceur: 'dialogue', avatar: { forme: 'robot', couleur: 'vert' }, personnalise: false },
	],
	ignores: [{ nom: 'A b', motif: 'nom refusé : minuscules, chiffres et tirets' }],
	avertissements: [{ nom: 'notes', motif: 'lanceur « propre » sans chemin de lancement connu' }],
};

function reponses(plus: Record<string, unknown> = {}) {
	return {
		'/api/sessions': { sessions: SESSIONS },
		'/api/sante': { ok: true, pid: 1, racine: '~/Developer', racineAbsolue: '/Users/ana/Developer', terminaux: { ok: true }, version: '0.1.0' },
		'/api/fil': { commits: [], aConfirmer: [], montees: [], modifications: [] },
		'/api/memoire/graphe': { coffre: '_mnemo', fiches: [], liens: [], notions: [], sens: { disponible: false, etat: 'absent' }, modifieeMs: 0 },
		'/api/dossiers': dossiersFaux([
			{ chemin: 'erp-saas', git: true, marque: true },
			{ chemin: 'api', git: true, marque: true },
			{ chemin: 'agent', git: true, marque: true },
			'vide',
		]),
		'/api/dossiers/git': (params: Record<string, string> | undefined) =>
			params?.['chemin'] === 'erp-saas' ? { branche: 'feat/lots', fichiers: [{ chemin: 'src/A.php', statut: 'M' }], modifies: 4 } : null,
		'/api/sessions/s1/servis': { servis: SERVIS },
		'/api/sessions/s2/servis': { servis: [] },
		'/api/sessions/s3/servis': { servis: [] },
		'/api/sessions/s4/servis': { servis: [] },
		'/api/sessions/s1/pause': { statut: 'ok' },
		'/api/sessions/s1/ecartes': { ecartes: [] },
		'/api/sessions/s2/ecartes': { ecartes: [] },
		'/api/sessions/s3/ecartes': { ecartes: [] },
		'/api/sessions/s4/ecartes': { ecartes: [] },
		'/api/profils': PROFILS,
		...plus,
	};
}

async function monter(plus: Record<string, unknown> = {}) {
	const faux = creerFauxClient(reponses(plus));
	render(<Application client={faux.client} />);
	await act(async () => faux.connexion.emettre({ type: 'sessions', sessions: SESSIONS }));
	return faux;
}

const carte = (id: string) => document.querySelector<HTMLElement>(`[data-session="${id}"]`)!;
const ligneDossier = (chemin: string) => document.querySelector<HTMLElement>(`[data-dossier="${chemin}"]`)!;
const cellule = (id: string) => document.querySelector<HTMLElement>(`[data-cellule="${id}"]`)!;

describe('vue Sessions', () => {
	it('grille par dossier, sans l’archiviste ; barre des états', async () => {
		await monter();
		const lignes = [...document.querySelectorAll('[data-ligne]')].map((l) => l.getAttribute('data-ligne'));
		expect(lignes).toEqual(['erp-saas', 'api', 'agent']);
		expect(carte('arch')).toBeNull();
		expect(screen.getByText('4 sessions | 1 attend ta réponse | 1 travaille')).toBeTruthy();
		expect(within(carte('s1')).getByText('⌥1')).toBeTruthy();
		expect(within(carte('s3')).getByText('⌥3')).toBeTruthy();
	});

	it('un message `session` passe une carte de « Travaille » à « Attend ta réponse », la pastille suit', async () => {
		const faux = await monter();
		const nav = screen.getByRole('navigation');
		expect(within(carte('s2')).getByRole('img', { name: 'Travaille' })).toBeTruthy();
		expect(within(nav).getByRole('button', { name: /Sessions/ }).textContent).toContain('1');
		await act(async () => faux.connexion.emettre({ type: 'session', session: { ...SESSIONS[1]!, etat: 'attend' } }));
		expect(within(carte('s2')).getByRole('img', { name: 'Attend ta réponse' })).toBeTruthy();
		expect(within(nav).getByRole('button', { name: /Sessions/ }).textContent).toContain('2');
	});

	it('⌥2 zoome la deuxième session (voisines en rail, autres lignes mini), focus après 360 ms ; ⌥2 de nouveau et Échap dézooment', async () => {
		await monter();
		await act(async () => fireEvent.keyDown(document.body, { code: 'Digit2', key: '™', altKey: true }));
		expect(cellule('s2').getAttribute('data-zoomee')).toBe('true');
		expect(cellule('s1').getAttribute('data-rail')).toBe('true');
		expect(document.querySelector('[data-ligne="api"]')!.getAttribute('data-mini')).toBe('true');
		expect(screen.getByLabelText('terminal s2').getAttribute('data-compact')).toBe('false');
		expect(screen.getByLabelText('terminal s2').getAttribute('data-actif')).toBe('true');
		expect(screen.getByLabelText('terminal s1').getAttribute('data-actif')).toBe('false');
		await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('terminal s2')), { timeout: 1000 });
		await act(async () => fireEvent.keyDown(document.body, { code: 'Digit2', altKey: true }));
		expect(cellule('s2').getAttribute('data-zoomee')).toBe('false');
		await act(async () => fireEvent.keyDown(document.body, { code: 'Digit1', altKey: true }));
		expect(cellule('s1').getAttribute('data-zoomee')).toBe('true');
		await act(async () => fireEvent.keyDown(document.body, { code: 'Escape', key: 'Escape' }));
		expect(cellule('s1').getAttribute('data-zoomee')).toBe('false');
	});

	it('⌥5 depuis un textarea, un input, un [contenteditable] ou un terminal : rien, la touche reste au champ ; depuis la page : session 5 en grand', async () => {
		const s5 = session('s5', 'agent', 5);
		const faux = await monter({ '/api/sessions/s5/servis': { servis: [] }, '/api/sessions/s5/ecartes': { ecartes: [] } });
		await act(async () => faux.connexion.emettre({ type: 'sessions', sessions: [...SESSIONS, s5] }));
		const hote = document.createElement('div');
		hote.innerHTML = '<textarea></textarea><input><div contenteditable="true"></div><div class="xterm"><textarea class="xterm-helper-textarea"></textarea></div>';
		document.body.append(hote);
		const champs = [hote.querySelector('textarea')!, hote.querySelector('input')!, hote.querySelector('[contenteditable]')!, hote.querySelector('.xterm textarea')!];
		const alt5 = { code: 'Digit5', key: '{', altKey: true };
		for (const champ of champs) {
			let annulee = false;
			await act(async () => {
				annulee = !fireEvent.keyDown(champ, alt5);
			});
			expect(annulee).toBe(false);
			expect(document.querySelector('[data-zoomee="true"]')).toBeNull();
		}
		let annulee = false;
		await act(async () => {
			annulee = !fireEvent.keyDown(document.body, alt5);
		});
		expect(annulee).toBe(true);
		expect(cellule('s5').getAttribute('data-zoomee')).toBe('true');
		hote.remove();
	});

	it('double-clic sur la barre d’une carte → zoom ; bouton ⤢ → réduit', async () => {
		await monter();
		await act(async () => fireEvent.doubleClick(within(carte('s3')).getByText('Objectif s3')));
		expect(cellule('s3').getAttribute('data-zoomee')).toBe('true');
		await act(async () => within(carte('s3')).getByRole('button', { name: 'Agrandir ou réduire' }).click());
		expect(cellule('s3').getAttribute('data-zoomee')).toBe('false');
	});

	it('panneau Contexte : « Injecté dans la session » : ◆ injectées, pistes proposées sans % (pas une injectée), lues ◈ dans la liste', async () => {
		const servis: EntreeServieVue[] = [
			{
				...SERVIS[0]!,
				cartes: [
					{ id: 'projets/erp-saas/Module stocks.md', titre: 'Module stocks', raison: 'perimetre' },
					{ id: 'projets/erp-saas/Lots.md', titre: 'Lots', raison: 'question', note: 0.64 },
					{ id: 'projets/erp-saas/Inventaire.md', titre: 'Inventaire', raison: 'nommee', note: 0.31 },
				],
			},
		];
		await monter({ '/api/sessions/s1/servis': { servis, lues: [{ chemin: 'consignes/Tests.md', horodatageMs: 0 }] } });
		const contexte = screen.getByRole('complementary', { name: 'Contexte' });
		const liste = await within(contexte).findByRole('list', { name: 'Injecté dans la session' });
		const lignes = within(liste).getAllByRole('listitem');
		// une fiche injectée n'est pas reproposée en carte
		// la fiche lue (heure inconnue : 0) est une ligne ◈ de la liste, après les cartes
		expect(lignes.map((l) => l.getAttribute('data-id'))).toEqual(['projets/erp-saas/Module stocks.md', 'projets/erp-saas/Lots.md', 'projets/erp-saas/Inventaire.md', 'consignes/Tests.md']);
		expect(within(lignes[0]!).getByRole('img', { name: 'Injectée dans la session' })).toBeTruthy();
		// une piste n'a pas de % hors du classement calibré : l'heure de son message, sa raison au survol
		expect(lignes[1]!.firstElementChild?.textContent).toBe('');
		expect(lignes[1]!.textContent).toMatch(/piste du message de \d\d:\d\d/u);
		expect(within(lignes[1]!).getByRole('button', { name: 'Lots' }).getAttribute('title')).toMatch(/ – question\n/u);
		expect(within(lignes[2]!).getByRole('button', { name: 'Inventaire' }).getAttribute('title')).toMatch(/ – nommée\n/u);
		expect(contexte.textContent).not.toMatch(/\d\u00a0%/u);
		expect(within(lignes[3]!).getByRole('img', { name: 'Lue par la session' }).textContent).toBe('◈');
		expect(within(lignes[3]!).getByRole('button', { name: 'Tests' }).getAttribute('title')).toMatch(/^lue par la session à \d\d:\d\d\nconsignes\/Tests\.md$/u);
		expect(within(contexte).queryByRole('group', { name: 'Lues par la session' })).toBeNull();
	});

	it('panneau Contexte : pistes proposées sans le sens : ni note ni repère (le classement dit « ordre seul » s’il y en a un)', async () => {
		const servis: EntreeServieVue[] = [{ ...SERVIS[0]!, sens: false, cartes: [{ id: 'projets/erp-saas/Lots.md', titre: 'Lots', raison: 'perimetre' }] }];
		await monter({ '/api/sessions/s1/servis': { servis, lues: [] } });
		const contexte = screen.getByRole('complementary', { name: 'Contexte' });
		const liste = await within(contexte).findByRole('list', { name: 'Injecté dans la session' });
		expect(within(liste).getAllByRole('listitem').at(-1)!.firstElementChild?.textContent).toBe('');
		expect(within(contexte).queryByText('sans note de sens')).toBeNull();
	});

	it('panneau Contexte : une fiche lue après l’ouverture (message `lues`) paraît sans recharger', async () => {
		const faux = await monter({ '/api/sessions/s1/servis': { servis: SERVIS, lues: [] } });
		const contexte = screen.getByRole('complementary', { name: 'Contexte' });
		const liste = await within(contexte).findByRole('list', { name: 'Injecté dans la session' });
		expect(within(liste).queryByRole('img', { name: 'Lue par la session' })).toBeNull();
		await act(async () => faux.connexion.emettre({ type: 'lues', session: 's1', lues: [{ chemin: 'projets/erp-saas/Inventaire.md', horodatageMs: 10 }] }));
		// une autre session n'y touche pas
		await act(async () => faux.connexion.emettre({ type: 'lues', session: 's2', lues: [{ chemin: 'projets/api/Autre.md', horodatageMs: 11 }] }));
		const lue = within(liste).getByRole('img', { name: 'Lue par la session' }).closest('li')!;
		expect(lue.getAttribute('data-id')).toBe('projets/erp-saas/Inventaire.md');
		expect(within(liste).getAllByRole('img', { name: 'Lue par la session' })).toHaveLength(1);
	});

	it('panneau Contexte : le dossier non rattaché est dit (texte du service) ; rattaché, rien', async () => {
		const faux = await monter();
		const contexte = screen.getByRole('complementary', { name: 'Contexte' });
		expect(within(contexte).queryByRole('note')).toBeNull();
		const texte = 'Dossier non rattaché : d/e ; les sessions qui y tournent ne reçoivent ni les consignes, ni les rappels, ni les épisodes, ni les skills d’un projet.';
		await act(async () => faux.connexion.emettre({ type: 'session', session: { ...SESSIONS[0]!, position: '', dossierNonRattache: texte } }));
		expect(within(contexte).getByRole('note').textContent).toBe(texte);
	});

	it('« Mettre en pause » → POST pause de la session choisie', async () => {
		const faux = await monter();
		const contexte = screen.getByRole('complementary', { name: 'Contexte' });
		expect(within(contexte).getByText('Attend ta réponse')).toBeTruthy();
		await act(async () => within(contexte).getByRole('button', { name: 'Mettre en pause' }).click());
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/sessions/s1/pause', undefined);
	});

	it('« Abandonner » demande une confirmation', async () => {
		const faux = await monter({ '/api/sessions/s1/abandon': { statut: 'ok' } });
		const contexte = screen.getByRole('complementary', { name: 'Contexte' });
		await act(async () => within(contexte).getByRole('button', { name: 'Abandonner' }).click());
		expect(faux.api.envoyer).not.toHaveBeenCalled();
		await act(async () => within(contexte).getByRole('button', { name: 'Confirmer l’abandon' }).click());
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/sessions/s1/abandon', undefined);
	});

	it('session sans terminal → encart et « Reprendre ici »', async () => {
		const faux = await monter({ '/api/sessions/s4/reprise': { statut: 'ok' } });
		expect(within(carte('s4')).getByText('Session suivie sans terminal dans Mnemo')).toBeTruthy();
		expect(screen.queryByLabelText('terminal s4')).toBeNull();
		await act(async () => within(carte('s4')).getByRole('button', { name: 'Reprendre ici' }).click());
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/sessions/s4/reprise', undefined);
	});

	it('fiches injectées sans doublon, en tête de la liste, plus anciennes d’abord ; clic → Mémoire › Fichiers sur la fiche', async () => {
		await monter();
		const contexte = screen.getByRole('complementary', { name: 'Contexte' });
		const liste = await within(contexte).findByRole('list', { name: 'Injecté dans la session' });
		const fiches = within(liste).getAllByRole('button', { name: /Module stocks|Tests/ });
		expect(fiches.map((b) => b.textContent)).toEqual(['Module stocks', 'Tests avant tout']);
		await act(async () => fiches[0]!.click());
		expect(screen.getByRole('main').getAttribute('data-vue')).toBe('memoire');
		expect(screen.getByRole('tab', { name: 'Fichiers' }).getAttribute('aria-selected')).toBe('true');
		expect(screen.getByText('projets / erp-saas / Module stocks.md')).toBeTruthy();
	});

	it('panneau Contexte : journal ancien, les injectées en tête (◆ à la place de la note), puis le classement en ordre seul (◇, sans %) ; clic → la fiche', async () => {
		await monter();
		const contexte = screen.getByRole('complementary', { name: 'Contexte' });
		const classement = await within(contexte).findByRole('list', { name: 'Injecté dans la session' });
		const lignes = within(classement).getAllByRole('listitem');
		expect(lignes.map((l) => l.getAttribute('data-id'))).toEqual(['projets/erp-saas/Module stocks.md', 'consignes/Tests.md', 'projets/erp-saas/Lots.md']);
		expect(lignes[1]!.firstElementChild?.textContent).toBe('◆');
		expect(lignes[2]!.firstElementChild?.textContent).toBe('◇');
		expect(within(contexte).getByText('ordre seul')).toBeTruthy();
		expect(within(lignes[1]!).getByRole('img', { name: 'Injectée dans la session' })).toBeTruthy();
		expect(within(lignes[2]!).queryByRole('img', { name: 'Injectée dans la session' })).toBeNull();
		await act(async () => within(lignes[2]!).getByRole('button', { name: 'Lots et péremption' }).click());
		expect(screen.getByRole('main').getAttribute('data-vue')).toBe('memoire');
	});

	it('⌥M ouvre la dernière fiche injectée', async () => {
		await monter();
		await screen.findAllByRole('button', { name: /Module stocks/ });
		await act(async () => fireEvent.keyDown(document.body, { code: 'KeyM', altKey: true }));
		expect(screen.getByRole('main').getAttribute('data-vue')).toBe('memoire');
		expect(screen.getByText('consignes / Tests.md')).toBeTruthy();
	});

	it('panneau Dossier : puce git, clic sur un dossier → sa première session choisie', async () => {
		await monter();
		const dossier = screen.getByRole('complementary', { name: 'Dossier' });
		expect(await within(dossier).findByText('feat/lots | 4 modif.')).toBeTruthy();
		await act(async () => within(ligneDossier('api')).getByRole('button', { name: /^api/ }).click());
		expect(screen.getByLabelText('terminal s3').getAttribute('data-actif')).toBe('true');
		const contexte = screen.getByRole('complementary', { name: 'Contexte' });
		expect(within(contexte).getByText('Objectif s3')).toBeTruthy();
	});

	it('panneau Dossier : un fichier modifié → « Chemin copié », chemin absolu (racine absolue de `sante`)', async () => {
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		await monter();
		const dossier = screen.getByRole('complementary', { name: 'Dossier' });
		const fichier = await within(dossier).findByTitle('Copier le chemin de src/A.php');
		// 4 fichiers modifiés, 1 listé : les autres sont comptés
		expect(within(dossier).getByText('3 de plus')).toBeTruthy();
		await act(async () => fichier.click());
		expect(writeText).toHaveBeenCalledWith('/Users/ana/Developer/erp-saas/src/A.php');
		expect(await screen.findByText('Chemin copié')).toBeTruthy();
	});

	it('panneau Dossier : fichiers git coupés par DePlus ; « Tout voir » demande la liste entière (PARAMETRES_TOUT)', async () => {
		const fichiers = Array.from({ length: 35 }, (_, i) => ({ chemin: `src/F${i}.php`, statut: 'M' as const }));
		await monter({
			'/api/dossiers/git': (params: Record<string, string> | undefined) =>
				params?.['chemin'] === 'erp-saas' ? { branche: 'feat/lots', fichiers: demandeTout(params) ? fichiers : fichiers.slice(0, FICHIERS_GIT_MAX), modifies: 35 } : null,
		});
		const dossier = screen.getByRole('complementary', { name: 'Dossier' });
		await within(dossier).findByTitle('Copier le chemin de src/F0.php');
		const listes = () => within(dossier).queryAllByTitle(/^Copier le chemin de src\/F/).length;
		expect(listes()).toBe(FICHIERS_GIT_MAX);
		expect(within(dossier).getByText(`${35 - FICHIERS_GIT_MAX} de plus`)).toBeTruthy();
		await act(async () => within(dossier).getByRole('button', { name: 'Tout voir' }).click());
		await waitFor(() => expect(listes()).toBe(35));
		expect(within(dossier).queryByText(/de plus/)).toBeNull();
	});

	it('bascules Dossier et Contexte masquent les panneaux', async () => {
		await monter();
		await act(async () => screen.getByRole('switch', { name: 'Contexte' }).click());
		expect(screen.queryByRole('complementary', { name: 'Contexte' })).toBeNull();
		await act(async () => screen.getByRole('switch', { name: 'Dossier' }).click());
		expect(screen.queryByRole('complementary', { name: 'Dossier' })).toBeNull();
	});

	it('Nouvelle session : POST sessions ; mode dégradé → la commande affichée avec « Copier »', async () => {
		const faux = await monter({
			'/api/sessions': (_: unknown, corps: unknown) => (corps === undefined ? { sessions: SESSIONS } : { session: SESSIONS[0], manuel: 'claude --session-id 1234 --plugin-dir x' }),
		});
		await act(async () => screen.getByRole('button', { name: '+ Nouvelle session' }).click());
		const dialogue = screen.getByRole('dialog', { name: 'Nouvelle session' });
		const arbre = within(dialogue).getByRole('group', { name: 'Dossier' });
		await cliquerQuandAffiche(within(arbre).findByRole('button', { name: /^api/ }));
		expect(within(arbre).getByText('Dossier : api')).toBeTruthy();
		fireEvent.change(within(dialogue).getByLabelText('Objectif (facultatif)'), { target: { value: 'Corriger le bug' } });
		await act(async () => within(dialogue).getByRole('button', { name: 'Lancer' }).click());
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/sessions', { profil: PROFIL_TRAVAIL, dossier: 'api', objectif: 'Corriger le bug' });
		expect(await within(dialogue).findByText('claude --session-id 1234 --plugin-dir x')).toBeTruthy();
		expect(within(dialogue).getByRole('button', { name: 'Copier' })).toBeTruthy();
	});

	it('Nouvelle session : les profils du service, PROFIL_TRAVAIL par défaut, description du profil choisi ; un profil de l’utilisateur est envoyé ; les noms refusés sont dits', async () => {
		const faux = await monter({ '/api/sessions': (_: unknown, corps: unknown) => (corps === undefined ? { sessions: SESSIONS } : { session: SESSIONS[0] }) });
		await act(async () => screen.getByRole('button', { name: '+ Nouvelle session' }).click());
		const dialogue = screen.getByRole('dialog', { name: 'Nouvelle session' });
		const choix = within(dialogue).getByLabelText<HTMLSelectElement>('Profil');
		await waitFor(() => expect([...choix.options].map((o) => o.value)).toEqual(['notes', 'redaction', PROFIL_TRAVAIL]));
		// un profil lancé par son propre chemin : montré à part, non sélectionnable, avec l'endroit où il se lance
		expect(within(dialogue).getByText(`${PROFIL_ARCHIVISTE} : lancé par son propre chemin, dans la mémoire.`)).toBeTruthy();
		expect(choix.value).toBe(PROFIL_TRAVAIL);
		expect(within(dialogue).getByText('La mémoire Mnemo est ta mémoire de référence.')).toBeTruthy();
		expect(within(dialogue).getByText(/A b : nom refusé/)).toBeTruthy();
		expect(within(dialogue).getByText('Profil notes : lanceur « propre » sans chemin de lancement connu')).toBeTruthy();
		fireEvent.change(choix, { target: { value: 'redaction' } });
		expect(within(dialogue).getByText('Rédige les courriers.')).toBeTruthy();
		await act(async () => within(dialogue).getByRole('button', { name: 'Lancer' }).click());
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/sessions', { profil: 'redaction', dossier: 'erp-saas' });
	});

	it('Nouvelle session : un profil lancé dans la mémoire remplace l’arbre par une phrase et envoie la racine', async () => {
		const faux = await monter({ '/api/sessions': (_: unknown, corps: unknown) => (corps === undefined ? { sessions: SESSIONS } : { session: SESSIONS[4] }) });
		await act(async () => screen.getByRole('button', { name: '+ Nouvelle session' }).click());
		const dialogue = screen.getByRole('dialog', { name: 'Nouvelle session' });
		const choix = within(dialogue).getByLabelText<HTMLSelectElement>('Profil');
		await waitFor(() => expect(choix.options.length).toBe(3));
		fireEvent.change(choix, { target: { value: 'notes' } });
		expect(within(dialogue).queryByRole('group', { name: 'Dossier' })).toBeNull();
		expect(within(dialogue).getByText(/se lance dans la mémoire/)).toBeTruthy();
		await act(async () => within(dialogue).getByRole('button', { name: 'Lancer' }).click());
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/sessions', { profil: 'notes', dossier: '' });
	});

	it('Nouvelle session : l’arbre du dialogue atteint un dossier caché profond, sans git ; envoyé tel quel ; la racine sans session choisie', async () => {
		const faux = await monter({
			'/api/sessions': (_: unknown, corps: unknown) => (corps === undefined ? { sessions: [] } : { session: session('n9', 'Documents/Paula/.archives', 90) }),
			'/api/dossiers': dossiersFaux(['Documents', 'Documents/Paula', 'Documents/Paula/.archives']),
		});
		await act(async () => faux.connexion.emettre({ type: 'sessions', sessions: [] }));
		await act(async () => screen.getByRole('button', { name: '+ Nouvelle session' }).click());
		const dialogue = screen.getByRole('dialog', { name: 'Nouvelle session' });
		const arbre = within(dialogue).getByRole('group', { name: 'Dossier' });
		expect(within(arbre).getByText('Dossier : Developer')).toBeTruthy();
		await cliquerQuandAffiche(within(arbre).findByRole('button', { name: 'Déplier Documents/Paula' }));
		await cliquerQuandAffiche(within(arbre).findByRole('button', { name: /^\.archives/ }));
		expect(within(arbre).getByText('Dossier : Documents/Paula/.archives')).toBeTruthy();
		await act(async () => within(dialogue).getByRole('button', { name: 'Lancer' }).click());
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/sessions', { profil: PROFIL_TRAVAIL, dossier: 'Documents/Paula/.archives' });
	});

	it('glissement d’un séparateur : classe globale `drag`, poids mémorisés ; une session lancée ensuite prend la moyenne du groupe', async () => {
		vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400);
		vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
		const nouvelle = session('s5', 'erp-saas', 50);
		const faux = await monter({ '/api/sessions': (_: unknown, corps: unknown) => (corps === undefined ? { sessions: SESSIONS } : { session: nouvelle }) });
		const grille = screen.getByRole('region', { name: 'Grille des sessions' });
		const separateur = document.querySelector<HTMLElement>('[data-ligne="erp-saas"] [data-separateur]')!;
		await act(async () => fireEvent.pointerDown(separateur, { clientX: 100, button: 0, pointerId: 1 }));
		expect(grille.classList.contains('drag')).toBe(true);
		await act(async () => fireEvent.pointerMove(separateur, { clientX: 150, pointerId: 1 }));
		expect(cellule('s1').style.flexGrow).toBe('450');
		expect(cellule('s2').style.flexGrow).toBe('350');
		await act(async () => fireEvent.pointerUp(separateur, { pointerId: 1 }));
		expect(grille.classList.contains('drag')).toBe(false);
		await act(async () => screen.getByRole('button', { name: '+ Nouvelle session' }).click());
		const dialogue = screen.getByRole('dialog', { name: 'Nouvelle session' });
		await act(async () => within(dialogue).getByRole('button', { name: 'Lancer' }).click());
		await act(async () => faux.connexion.emettre({ type: 'session', session: nouvelle }));
		expect(cellule('s5').style.flexGrow).toBe('400');
	});

	it('séparateurs de la grille au clavier : flèches de leur axe (Maj : grand pas), Début et Fin aux minimums', async () => {
		vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400);
		vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
		await monter();
		const [entre] = within(document.querySelector<HTMLElement>('[data-ligne="erp-saas"]')!).getAllByRole('separator', { name: 'Largeur des sessions voisines' }) as [HTMLElement];
		expect(entre.tabIndex).toBe(0);
		expect([entre.getAttribute('aria-valuenow'), entre.getAttribute('aria-valuemin'), entre.getAttribute('aria-valuemax')]).toEqual(['400', String(MINIMUM_COLONNE), String(800 - MINIMUM_COLONNE)]);
		await act(async () => fireEvent.keyDown(entre, { key: 'ArrowRight' }));
		expect([cellule('s1').style.flexGrow, cellule('s2').style.flexGrow]).toEqual(['420', '380']);
		await act(async () => fireEvent.keyDown(entre, { key: 'ArrowLeft', shiftKey: true }));
		expect([cellule('s1').style.flexGrow, cellule('s2').style.flexGrow]).toEqual(['320', '480']);
		await act(async () => fireEvent.keyDown(entre, { key: 'Home' }));
		expect(cellule('s1').style.flexGrow).toBe(String(MINIMUM_COLONNE));
		const lignes = screen.getAllByRole('separator', { name: 'Hauteur des dossiers voisins' });
		expect(lignes.length).toBeGreaterThan(0);
		await act(async () => fireEvent.keyDown(lignes[0]!, { key: 'ArrowDown' }));
		expect((lignes[0]!.previousElementSibling as HTMLElement).style.flexGrow).toBe('320');
	});

	it('beaucoup de dossiers : les lignes défilent sous la hauteur minimale MINIMUM_LIGNE, la barre d’aide reste hors du défilement ; pastilles et « + session » atteignables', async () => {
		const css = readFileSync(join(import.meta.dirname, '../../src/composants/sessions/GrilleSessions.module.css'), 'utf8');
		const regle = (selecteur: string) => {
			const debut = css.indexOf(`\n${selecteur} {`);
			expect(debut, selecteur).toBeGreaterThanOrEqual(0);
			return css.slice(debut, css.indexOf('}', debut));
		};
		expect(regle('.lignes')).toMatch(/overflow-y: auto;/);
		expect(regle('.grille')).not.toMatch(/overflow/);
		expect(css).not.toMatch(/min-height: \d{3}px/);
		expect(regle('.pastilles')).toMatch(/overflow-x: auto;/);
		expect(regle('.ib')).toMatch(/flex: none;/);
		await monter();
		const grille = screen.getByRole('region', { name: 'Grille des sessions' });
		// la hauteur minimale d'une ligne dépliée est MINIMUM_LIGNE, la borne du glisser
		expect(grille.querySelector<HTMLElement>('[data-ligne="erp-saas"]')!.style.minHeight).toBe(`${MINIMUM_LIGNE}px`);
		const defile = grille.querySelector<HTMLElement>('[data-ligne]')!.parentElement!;
		expect(defile).not.toBe(grille);
		expect(defile.contains(grille.querySelector('[data-aide]'))).toBe(false);
	});

	it('⌥0 dézoome ; ⌥n ignoré tant que le dialogue est ouvert ; le rail porte son raccourci', async () => {
		await monter();
		await act(async () => fireEvent.keyDown(document.body, { code: 'Digit1', altKey: true }));
		expect(cellule('s1').getAttribute('data-zoomee')).toBe('true');
		expect(cellule('s2').querySelector('button')!.getAttribute('aria-keyshortcuts')).toBe('Alt+2');
		await act(async () => fireEvent.keyDown(document.body, { code: 'Digit0', altKey: true }));
		expect(cellule('s1').getAttribute('data-zoomee')).toBe('false');
		await act(async () => screen.getByRole('button', { name: '+ Nouvelle session' }).click());
		await act(async () => fireEvent.keyDown(document.body, { code: 'Digit2', altKey: true }));
		expect(cellule('s2').getAttribute('data-zoomee')).toBe('false');
	});

	it('session terminée alors qu’elle est zoomée et choisie : retirée, grille dézoomée, la première choisie', async () => {
		const faux = await monter();
		await act(async () => fireEvent.keyDown(document.body, { code: 'Digit2', altKey: true }));
		await act(async () => faux.connexion.emettre({ type: 'session', session: { ...SESSIONS[1]!, etat: 'terminee' } }));
		expect(cellule('s2')).toBeNull();
		expect(document.querySelector('[data-zoomee="true"]')).toBeNull();
		expect(document.querySelector('[data-rail="true"]')).toBeNull();
		const contexte = screen.getByRole('complementary', { name: 'Contexte' });
		expect(within(contexte).getByText('Objectif s1')).toBeTruthy();
		expect(screen.getByLabelText('terminal s1').getAttribute('data-actif')).toBe('true');
	});

	it('sessions à la racine et dans un sous-dossier : le chemin se déplie de lui-même ; le dialogue lance dans le dossier affiché', async () => {
		const racine = session('r1', '', 60);
		const imbriquee = session('n1', 'erp-saas/achats', 61);
		const faux = await monter({
			'/api/dossiers': dossiersFaux([{ chemin: 'erp-saas', git: true, marque: true }, 'erp-saas/achats', 'api', 'agent']),
			'/api/sessions': (_: unknown, corps: unknown) => (corps === undefined ? { sessions: SESSIONS } : { session: racine }),
		});
		await act(async () => faux.connexion.emettre({ type: 'sessions', sessions: [...SESSIONS, racine, imbriquee] }));
		const dossier = screen.getByRole('complementary', { name: 'Dossier' });
		const lignes = () => [...dossier.querySelectorAll<HTMLElement>('[data-dossier]')].map((l) => l.dataset['dossier']);
		// dans l'ordre du service
		await waitFor(() => expect(lignes()).toEqual(['', 'erp-saas', 'erp-saas/achats', 'api', 'agent']));
		await act(async () => within(ligneDossier('erp-saas/achats')).getByRole('button', { name: /^achats/ }).click());
		expect(within(screen.getByRole('complementary', { name: 'Contexte' })).getByText('Objectif n1')).toBeTruthy();
		await act(async () => within(ligneDossier('')).getByRole('button', { name: /^Developer/ }).click());
		expect(within(screen.getByRole('complementary', { name: 'Contexte' })).getByText('Objectif r1')).toBeTruthy();

		await act(async () => within(dossier).getByRole('button', { name: '+ session' }).click());
		const dialogue = screen.getByRole('dialog', { name: 'Nouvelle session' });
		await act(async () => within(dialogue).getByRole('button', { name: 'Lancer' }).click());
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/sessions', { profil: PROFIL_TRAVAIL, dossier: '' });
	});

	it('arbre : un dossier de n’importe quel nom, caché ou non, sans git, atteint par dépliages successifs ; ◆ et état git seulement quand le contenu le dit', async () => {
		const faux = await monter({
			'/api/dossiers': dossiersFaux([{ chemin: 'erp-saas', git: true, marque: true }, 'api', 'agent', 'Documents', 'Documents/Paula', 'Documents/Paula/.archives', { chemin: 'Outils', marque: true }]),
		});
		const dossier = screen.getByRole('complementary', { name: 'Dossier' });
		// 2 niveaux affichés dépliés au départ : la racine et chacun de ses dossiers ; le 3e attend un dépliage
		await waitFor(() => expect(within(dossier).getByRole('button', { name: 'Déplier Documents/Paula' })).toBeTruthy());
		expect(within(dossier).getByRole('button', { name: 'Replier Documents' }).getAttribute('aria-expanded')).toBe('true');
		expect(within(dossier).getByRole('button', { name: /^Paula/ })).toBeTruthy();
		expect(faux.api.lire).toHaveBeenCalledWith('/api/dossiers', { chemin: '' });
		expect(faux.api.lire).toHaveBeenCalledWith('/api/dossiers', { chemin: 'Documents' });
		expect(faux.api.lire).not.toHaveBeenCalledWith('/api/dossiers', { chemin: 'Documents/Paula' });
		await act(async () => within(dossier).getByRole('button', { name: 'Déplier Documents/Paula' }).click());
		const archives = await within(dossier).findByRole('button', { name: /^\.archives/ });
		expect(archives.getAttribute('title')).toBe('Documents/Paula/.archives');
		expect(within(ligneDossier('Outils')).getByTitle('Projet')).toBeTruthy();
		expect(within(ligneDossier('Documents')).queryByTitle('Projet')).toBeNull();
		// état git demandé pour un dépôt (erp-saas a des sessions), jamais pour un autre dossier
		await waitFor(() => expect(faux.api.lire).toHaveBeenCalledWith('/api/dossiers/git', { chemin: 'erp-saas' }));
		await act(async () => archives.click());
		expect(faux.api.lire).not.toHaveBeenCalledWith('/api/dossiers/git', { chemin: 'Documents/Paula/.archives' });
		await act(async () => within(dossier).getByRole('button', { name: '+ session' }).click());
		const dialogue = screen.getByRole('dialog', { name: 'Nouvelle session' });
		await act(async () => within(dialogue).getByRole('button', { name: 'Lancer' }).click());
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/sessions', { profil: PROFIL_TRAVAIL, dossier: 'Documents/Paula/.archives' });
	});

	it('arbre : un dossier illisible montre son motif, ses voisins s’affichent', async () => {
		await monter({ '/api/dossiers': dossiersFaux(['agent', 'api', 'erp-saas', { chemin: 'Prive', erreur: 'lecture refusée' }, 'Public']) });
		const dossier = screen.getByRole('complementary', { name: 'Dossier' });
		expect(await within(dossier).findByText('lecture refusée')).toBeTruthy();
		expect(within(dossier).queryByRole('button', { name: 'Déplier Prive' })).toBeNull();
		expect(within(ligneDossier('Public')).getByRole('button', { name: /^Public/ })).toBeTruthy();
	});

	it('après un rechargement : une session dans un dossier profond et caché garde son chemin visible', async () => {
		const profonde = session('p1', 'Documents/Paula/.archives', 62);
		const faux = creerFauxClient(
			reponses({
				'/api/sessions': { sessions: [...SESSIONS, profonde] },
				'/api/dossiers': dossiersFaux(['agent', 'api', 'erp-saas', 'Documents', 'Documents/Paula', 'Documents/Paula/.archives']),
			}),
		);
		render(<Application client={faux.client} />);
		await act(async () => faux.connexion.emettre({ type: 'sessions', sessions: [...SESSIONS, profonde] }));
		const dossier = screen.getByRole('complementary', { name: 'Dossier' });
		expect(await within(dossier).findByRole('button', { name: /^\.archives/ })).toBeTruthy();
	});

	it('refus renvoyé en ErreurApi 400 → le motif ; objectif borné à OBJECTIF_MAX, la borne du service', async () => {
		await monter({
			'/api/sessions': (_: unknown, corps: unknown) => {
				if (corps === undefined) return { sessions: SESSIONS };
				throw new ErreurApi('Profil inconnu.', 400);
			},
		});
		await act(async () => screen.getByRole('button', { name: '+ Nouvelle session' }).click());
		const dialogue = screen.getByRole('dialog', { name: 'Nouvelle session' });
		expect(within(dialogue).getByLabelText('Objectif (facultatif)').getAttribute('maxlength')).toBe(String(OBJECTIF_MAX));
		await act(async () => within(dialogue).getByRole('button', { name: 'Lancer' }).click());
		expect((await within(dialogue).findByRole('alert')).textContent).toContain('Profil inconnu.');
	});

	it('« Reprendre ici » sans terminal obtenu → toast', async () => {
		await monter({ '/api/sessions/s4/reprise': { session: { ...SESSIONS[3]!, etat: 'travaille', terminal: false, dialogueOuvert: false } } });
		await act(async () => within(carte('s4')).getByRole('button', { name: 'Reprendre ici' }).click());
		expect((await screen.findByRole('status')).textContent).toBe('La session tourne ailleurs, ou les terminaux sont indisponibles.');
	});

	it('carte : « Fermer la session » ouvre un menu ; « Abandonner » demande une confirmation puis appelle abandon', async () => {
		const faux = await monter({ '/api/sessions/s2/abandon': { statut: 'ok' } });
		const fermer = within(carte('s2')).getByRole('button', { name: 'Fermer la session' });
		expect(fermer.getAttribute('aria-haspopup')).toBe('menu');
		await act(async () => fermer.click());
		const menu = within(carte('s2')).getByRole('menu', { name: 'Fermer la session' });
		expect(faux.api.envoyer).not.toHaveBeenCalled();
		await act(async () => within(menu).getByRole('menuitem', { name: 'Abandonner' }).click());
		expect(faux.api.envoyer).not.toHaveBeenCalled();
		await act(async () => within(menu).getByRole('menuitem', { name: 'Confirmer l’abandon' }).click());
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/sessions/s2/abandon', undefined);
		expect(within(carte('s2')).queryByRole('menu')).toBeNull();
	});

	it('carte zoomée : « Fermer la session » → « Terminer avec bilan » appelle bilan ; « Annuler » referme sans rien appeler', async () => {
		const faux = await monter({ '/api/sessions/s1/bilan': { statut: 'ok' } });
		await act(async () => fireEvent.keyDown(document.body, { code: 'Digit1', altKey: true }));
		expect(cellule('s1').getAttribute('data-zoomee')).toBe('true');
		const fermer = within(carte('s1')).getByRole('button', { name: 'Fermer la session' });
		await act(async () => fermer.click());
		await act(async () => within(carte('s1')).getByRole('menuitem', { name: 'Abandonner' }).click());
		await act(async () => within(carte('s1')).getByRole('menuitem', { name: 'Annuler' }).click());
		expect(within(carte('s1')).queryByRole('menu')).toBeNull();
		await act(async () => fermer.click());
		await act(async () => within(carte('s1')).getByRole('menuitem', { name: 'Terminer avec bilan' }).click());
		expect(faux.api.envoyer).toHaveBeenCalledTimes(1);
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/sessions/s1/bilan', undefined);
	});

	it('menu de fermeture au clavier : flèches entre les items, « Annuler » focalisé à la confirmation ; Échap, Tab et Annuler le ferment, focus rendu au ×', async () => {
		await monter();
		const fermer = within(carte('s2')).getByRole('button', { name: 'Fermer la session' });
		const ouvrir = async () => {
			await act(async () => fermer.click());
			return within(carte('s2')).getByRole('menu', { name: 'Fermer la session' });
		};
		let menu = await ouvrir();
		const items = within(menu).getAllByRole('menuitem');
		expect(document.activeElement).toBe(items[0]);
		fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
		expect(document.activeElement).toBe(items[1]);
		fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
		expect(document.activeElement).toBe(items[0]);
		fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
		expect(document.activeElement).toBe(items[1]);
		await act(async () => fireEvent.keyDown(document.activeElement!, { key: 'Escape' }));
		expect(within(carte('s2')).queryByRole('menu')).toBeNull();
		expect(document.activeElement).toBe(fermer);

		menu = await ouvrir();
		await act(async () => fireEvent.keyDown(document.activeElement!, { key: 'Tab' }));
		expect(within(carte('s2')).queryByRole('menu')).toBeNull();
		expect(document.activeElement).toBe(fermer);

		menu = await ouvrir();
		await act(async () => within(menu).getByRole('menuitem', { name: 'Abandonner' }).click());
		expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Annuler' }));
		await act(async () => within(menu).getByRole('menuitem', { name: 'Annuler' }).click());
		expect(within(carte('s2')).queryByRole('menu')).toBeNull();
		expect(document.activeElement).toBe(fermer);
	});

	it('Terminées : le focus entre dans le tiroir et revient au lien ; le tiroir de l’archiviste et celui des terminées ne s’ouvrent pas l’un sur l’autre', async () => {
		await monter({ '/api/historique': { sessions: [{ ...session('t1', 'erp-saas', 10, { etat: 'terminee' }), episode: null }] } });
		const lien = await screen.findByRole('button', { name: '1 terminée' });
		lien.focus();
		await act(async () => lien.click());
		const panneau = screen.getByRole('complementary', { name: 'Sessions terminées' });
		expect(panneau.contains(document.activeElement)).toBe(true);
		await act(async () => fireEvent.keyDown(document.body, { code: 'Escape', key: 'Escape' }));
		expect(document.activeElement).toBe(lien);

		const archiviste = document.querySelector<HTMLElement>('aside[data-ouvert][aria-label="Archiviste"]')!;
		await act(async () => lien.click());
		await act(async () => fireEvent.keyDown(document.body, { code: 'KeyA', key: 'å', altKey: true }));
		expect(archiviste.getAttribute('data-ouvert')).toBe('true');
		expect(panneau.getAttribute('data-ouvert')).toBe('false');
		await act(async () => lien.click());
		expect(panneau.getAttribute('data-ouvert')).toBe('true');
		expect(archiviste.getAttribute('data-ouvert')).toBe('false');
	});

	it('« 2 terminées » : liste des sessions terminées (titre, dossier, bilan) ; « Retirer de l’historique » confirmé → DELETE ; refus 409 → motif', async () => {
		const terminees = [
			{ ...session('t1', 'erp-saas', 10, { etat: 'terminee', objectif: 'Schéma des lots' }), episode: { chemin: 'episodes/erp-saas/2026-11-21-lots.md', titre: 'Schéma des lots', minimal: false } },
			{ ...session('t2', 'api', 11, { etat: 'terminee', objectif: null }), episode: null },
		];
		let restantes = terminees;
		const faux = await monter({
			'/api/historique': () => ({ sessions: restantes }),
			'DELETE /api/sessions/t1': () => {
				restantes = restantes.filter((x) => x.id !== 't1');
				return { id: 't1' };
			},
			'DELETE /api/sessions/t2': () => {
				throw new ErreurApi('Seule une session terminée peut être retirée de l’historique.', 409);
			},
			'/api/memoire/fiche': { chemin: 'episodes/erp-saas/2026-11-21-lots.md', titre: 'Schéma des lots', type: 'episode', proprietes: [], corps: '', brut: '', empreinte: 'e', liens: { sortants: [], entrants: [] }, sessions: [], sessionsTotal: 0, avertissements: [] },
		});
		const lien = await screen.findByRole('button', { name: '2 terminées' });
		await act(async () => lien.click());
		const panneau = screen.getByRole('complementary', { name: 'Sessions terminées' });
		const lignes = within(panneau).getAllByRole('listitem');
		expect(lignes).toHaveLength(2);
		expect(lignes[0]!.textContent).toContain('Schéma des lots');
		expect(lignes[0]!.textContent).toContain('erp-saas');
		expect(within(lignes[0]!).getByRole('button', { name: /Bilan : Schéma des lots/ })).toBeTruthy();
		expect(lignes[1]!.textContent).toContain('Sans objectif');
		expect(lignes[1]!.textContent).toContain('Sans bilan');

		await act(async () => within(lignes[0]!).getByRole('button', { name: 'Retirer de l’historique' }).click());
		expect(faux.api.supprimer).not.toHaveBeenCalled();
		await act(async () => within(lignes[0]!).getByRole('button', { name: 'Confirmer le retrait' }).click());
		expect(faux.api.supprimer).toHaveBeenCalledWith('/api/sessions/t1');
		await waitFor(() => expect(within(panneau).getAllByRole('listitem')).toHaveLength(1));
		expect(screen.getByRole('button', { name: '1 terminée' })).toBeTruthy();

		const reste = within(panneau).getByRole('listitem');
		await act(async () => within(reste).getByRole('button', { name: 'Retirer de l’historique' }).click());
		await act(async () => within(reste).getByRole('button', { name: 'Confirmer le retrait' }).click());
		expect((await screen.findByRole('status')).textContent).toBe('Seule une session terminée peut être retirée de l’historique.');
		expect(within(panneau).getAllByRole('listitem')).toHaveLength(1);
	});

	it('Terminées : le bilan s’ouvre dans Mémoire ; Échap ferme la liste', async () => {
		await monter({
			'/api/historique': { sessions: [{ ...session('t1', 'erp-saas', 10, { etat: 'terminee' }), episode: { chemin: 'episodes/erp-saas/x.md', titre: 'Bilan X', minimal: true } }] },
		});
		await act(async () => (await screen.findByRole('button', { name: '1 terminée' })).click());
		const panneau = screen.getByRole('complementary', { name: 'Sessions terminées' });
		expect(panneau.getAttribute('data-ouvert')).toBe('true');
		await act(async () => fireEvent.keyDown(document.body, { code: 'Escape', key: 'Escape' }));
		expect(panneau.getAttribute('data-ouvert')).toBe('false');
		await act(async () => screen.getByRole('button', { name: '1 terminée' }).click());
		await act(async () => within(panneau).getByRole('button', { name: /Épisode minimal : Bilan X/ }).click());
		expect(screen.getByRole('main').getAttribute('data-vue')).toBe('memoire');
	});

	it('la racine reçoit le même traitement que tout dossier : ◆ si marque, état git si dépôt', async () => {
		const racine = session('r1', '', 60);
		const faux = await monter({
			'/api/dossiers': dossiersFaux(['agent', 'api', 'erp-saas'], { git: true, marque: true }),
			'/api/sessions': { sessions: [...SESSIONS, racine] },
			'/api/dossiers/git': (params: Record<string, string> | undefined) => (params?.['chemin'] === '' ? { branche: 'main', fichiers: [], modifies: 2 } : null),
		});
		await act(async () => faux.connexion.emettre({ type: 'sessions', sessions: [...SESSIONS, racine] }));
		expect(await within(ligneDossier('')).findByText('main | 2 modif.')).toBeTruthy();
		expect(within(ligneDossier('')).getByTitle('Projet')).toBeTruthy();
	});

	it('après un rechargement : une session au niveau 5 garde son chemin visible', async () => {
		const profonde = session('p5', 'a/b/c/d/e', 63);
		const faux = creerFauxClient(reponses({ '/api/sessions': { sessions: [...SESSIONS, profonde] }, '/api/dossiers': dossiersFaux(['agent', 'api', 'erp-saas', 'a', 'a/b', 'a/b/c', 'a/b/c/d', 'a/b/c/d/e']) }));
		render(<Application client={faux.client} />);
		await act(async () => faux.connexion.emettre({ type: 'sessions', sessions: [...SESSIONS, profonde] }));
		const dossier = screen.getByRole('complementary', { name: 'Dossier' });
		expect(await within(dossier).findByTitle('a/b/c/d/e')).toBeTruthy();
	});

	it('un niveau est relu quand il redevient visible : un dossier créé après l’ouverture apparaît au dépliage suivant', async () => {
		const disque = ['agent', 'api', 'erp-saas', 'Projets', 'Projets/A'];
		const faux = await monter({ '/api/dossiers': (p: Record<string, string> | undefined) => dossiersFaux(disque)(p) });
		const panneau = screen.getByRole('complementary', { name: 'Dossier' });
		await within(panneau).findByRole('button', { name: /^A/ });
		disque.push('Projets/B');
		await act(async () => within(panneau).getByRole('button', { name: 'Replier Projets' }).click());
		await act(async () => within(panneau).getByRole('button', { name: 'Déplier Projets' }).click());
		expect(await within(panneau).findByRole('button', { name: /^B/ })).toBeTruthy();
		expect(faux.api.lire.mock.calls.filter(([c, p]) => c === '/api/dossiers' && (p as Record<string, string>)['chemin'] === 'Projets')).toHaveLength(2);
	});

	it('panneau Dossier : « Tout replier » / « Tout déplier », ⌘- et ⌘+ quand il a le focus ; état gardé quand le panneau est masqué', async () => {
		await monter({ '/api/dossiers': dossiersFaux([{ chemin: 'erp-saas', git: true, marque: true }, 'api', 'agent', 'Projets', { chemin: 'Projets/A', marque: true }]) });
		const panneau = () => screen.getByRole('complementary', { name: 'Dossier' });
		// le 2e niveau est affiché dès l'ouverture
		await within(panneau()).findByRole('button', { name: /^A/ });
		await act(async () => within(panneau()).getByRole('button', { name: 'Tout replier' }).click());
		expect(within(panneau()).queryByRole('button', { name: /^A/ })).toBeNull();
		await act(async () => within(panneau()).getByRole('button', { name: 'Tout déplier' }).click());
		expect(within(panneau()).getByRole('button', { name: /^A/ })).toBeTruthy();

		// raccourcis : seulement avec le focus dans l'arbre, et alors sans laisser le navigateur zoomer
		const horsArbre = fireEvent.keyDown(document.body, { key: '-', code: 'Minus', metaKey: true });
		expect(horsArbre).toBe(true);
		expect(within(panneau()).getByRole('button', { name: /^A/ })).toBeTruthy();
		const projets = within(panneau()).getByRole('button', { name: 'Replier Projets' });
		projets.focus();
		let suite = true;
		await act(async () => void (suite = fireEvent.keyDown(projets, { key: '-', code: 'Minus', metaKey: true })));
		expect(suite).toBe(false);
		expect(within(panneau()).queryByRole('button', { name: /^A/ })).toBeNull();

		// masqué puis remontré : toujours replié
		await act(async () => screen.getByRole('switch', { name: 'Dossier' }).click());
		await act(async () => screen.getByRole('switch', { name: 'Dossier' }).click());
		const deplier = await within(panneau()).findByRole('button', { name: 'Déplier Projets' });
		expect(within(panneau()).queryByRole('button', { name: /^A/ })).toBeNull();
		deplier.focus();
		await act(async () => void fireEvent.keyDown(deplier, { key: '=', code: 'Equal', metaKey: true }));
		expect(within(panneau()).getByRole('button', { name: /^A/ })).toBeTruthy();
	});

	it('session en pause : « Reprendre » et « Terminer avec bilan »', async () => {
		const faux = await monter({ '/api/sessions/s3/bilan': { statut: 'ok' } });
		await act(async () => within(screen.getByRole('complementary', { name: 'Dossier' })).getByRole('button', { name: /api/ }).click());
		const contexte = screen.getByRole('complementary', { name: 'Contexte' });
		expect(within(contexte).getByRole('button', { name: 'Reprendre' })).toBeTruthy();
		await act(async () => within(contexte).getByRole('button', { name: 'Terminer avec bilan' }).click());
		expect(faux.api.envoyer).toHaveBeenCalledWith('/api/sessions/s3/bilan', undefined);
	});
});
