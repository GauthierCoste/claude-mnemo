import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { avertissementIndex } from '../../src/application/synchroniser.ts';
import { ENTETE_REMPLACEMENT, ROUTES } from '@mnemo/contrat';
import type { FicheVue, ReponseProfils, SessionVue } from '@mnemo/contrat';
import { PROFIL_ARCHIVISTE, PROFIL_TRAVAIL } from '@mnemo/commun';
import { SANS_EXTRACTION, synchroniser } from '../../src/application/synchroniser.ts';
import { vectoriser } from '../../src/application/vectoriser.ts';
import type { GesteANoter, Sens } from '../../src/application/ports.ts';
import { echelleDesSignaux, modeleNonAppris } from '../../src/domaine/modele-de-note.ts';
import type { Session } from '../../src/domaine/session.ts';
import { texteDuRefus } from '../../src/domaine/refus-outil.ts';
import { ecrirePlugin } from '../../src/infra/claude.ts';
import { appeler, jusqua, serviceFaux } from '../aides/service-faux.ts';
import { traiterEvenement } from '../../src/application/evenements.ts';
import { DEPOT_ABSENT } from '../aides/faux-ports.ts';
import { fauxSens } from '../aides/faux-sens.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import type { ContexteService } from '../aides/service-faux.ts';

const chemin = (route: string, id: string) => route.replace(':id', id);
const CLES_VUE = ['bilanDemandeMs', 'branche', 'commitDebut', 'creeeMs', 'dialogueOuvert', 'dossier', 'dossierNonRattache', 'etat', 'id', 'majMs', 'niveauModeles', 'objectif', 'position', 'profil', 'projet', 'terminal'];

function api(c: ContexteService) {
	const { port, jeton } = c.service;
	return {
		get: (route: string) => appeler(port, 'GET', route, { jeton }),
		post: (route: string, corps?: unknown) => appeler(port, 'POST', route, { jeton, corps: corps ?? {} }),
		supprimer: (route: string) => appeler(port, 'DELETE', route, { jeton }),
	};
}

async function lancer(c: ContexteService, corps: Record<string, unknown> = { profil: 'travail', dossier: 'alpha', objectif: 'Refaire le catalogue' }): Promise<SessionVue> {
	const r = await api(c).post(ROUTES.sessions, corps);
	expect(r.statut).toBe(201);
	return (r.corps as { session: SessionVue }).session;
}

const UUID = '11111111-2222-4333-8444-555555555555';
function sessionFixe(id: string, surcharge: Partial<Session> = {}): Session {
	return {
		id,
		profil: 'travail',
		dossier: 'alpha',
		position: 'projets/alpha',
		projet: 'alpha',
		objectif: 'Objectif',
		etat: 'attend',
		creeeMs: 1000,
		majMs: 1000,
		arretAttendu: null,
		bilanDemandeMs: null,
		commitDebut: null,
		branche: null,
		pid: null,
		...surcharge,
	};
}

describe('routes : sessions', () => {
	it('GET sante', async () => {
		const c = await serviceFaux();
		const r = await api(c).get(ROUTES.sante);
		expect(r.statut).toBe(200);
		expect(r.corps).toMatchObject({ ok: true });
	});

	it('POST sessions : lancée (terminal), vue du contrat seulement ; GET sessions et GET session', async () => {
		const c = await serviceFaux();
		const vue = await lancer(c);
		expect(Object.keys(vue).sort()).toEqual(CLES_VUE);
		expect(vue).toMatchObject({ profil: 'travail', dossier: 'alpha', etat: 'attend', terminal: true, objectif: 'Refaire le catalogue' });
		expect(c.terminaux.lances).toHaveLength(1);
		const liste = await api(c).get(ROUTES.sessions);
		expect(liste.statut).toBe(200);
		expect((liste.corps as { sessions: SessionVue[] }).sessions.map((s) => s.id)).toEqual([vue.id]);
		const une = await api(c).get(chemin(ROUTES.session, vue.id));
		expect(une.statut).toBe(200);
		expect((une.corps as { session: SessionVue }).session).toMatchObject({ id: vue.id, terminal: true });
		expect((await api(c).get(chemin(ROUTES.session, UUID))).statut).toBe(404);
		expect((await api(c).get(chemin(ROUTES.session, 'pas-un-uuid'))).statut).toBe(404);
	});

	it('POST sessions : refus lisibles → 400 { erreur } (dossier refusé, champ manquant, champ inconnu, types)', async () => {
		const c = await serviceFaux();
		for (const corps of [{ profil: 'travail', dossier: '../ailleurs' }, { profil: 'travail' }, { dossier: 'alpha', pirate: 1 }, { dossier: 3 }, { dossier: 'alpha', objectif: 4 }, [], 'texte']) {
			const r = await api(c).post(ROUTES.sessions, corps);
			expect(r.statut, JSON.stringify(corps)).toBe(400);
			expect(r.corps).toEqual({ erreur: expect.any(String) });
		}
		const json = await appeler(c.service.port, 'POST', ROUTES.sessions, { jeton: c.service.jeton, corps: new TextEncoder().encode('{pas du json'), entetes: { 'content-type': 'application/json' } });
		expect(json.statut).toBe(400);
		expect(c.terminaux.lances).toHaveLength(0);
	});

	it('POST sessions en mode dégradé : la ligne de commande à coller (manuel)', async () => {
		const c = await serviceFaux();
		c.terminaux.indisponible = 'node-pty absent';
		const r = await api(c).post(ROUTES.sessions, { dossier: 'alpha' });
		expect(r.statut).toBe(201);
		expect(r.corps).toMatchObject({ session: { terminal: false }, manuel: expect.stringContaining('--session-id') });
	});

	it('GET profils : ceux du paquet et ceux de profils/, décrits ; un nom refusé est rendu avec son motif', async () => {
		const c = await serviceFaux();
		await c.dep.coffre.ecrire('profils/redaction/redaction.md', '---\ntype: profil\n---\n# Rédaction\n\nRédige les courriers.\n');
		await c.dep.coffre.ecrire('profils/A b/A b.md', '---\ntype: profil\n---\n# x\n\ny\n');
		const r = await api(c).get(ROUTES.profils);
		expect(r.statut).toBe(200);
		const corps = r.corps as ReponseProfils;
		expect(corps.profils.map((p) => [p.nom, p.lancement])).toEqual([[PROFIL_ARCHIVISTE, 'memoire'], ['redaction', 'projet'], [PROFIL_TRAVAIL, 'projet']]);
		expect(corps.profils[1]!.description).toBe('Rédige les courriers.');
		expect(corps.ignores.map((x) => x.nom)).toEqual(['A b']);
	});

	it('POST sessions sans profil : PROFIL_TRAVAIL ; avec un profil de profils/ : ce profil', async () => {
		const c = await serviceFaux();
		await c.dep.coffre.ecrire('profils/redaction/redaction.md', '---\ntype: profil\n---\n# Rédaction\n\nRédige les courriers.\n');
		expect((await lancer(c, { dossier: 'alpha' })).profil).toBe(PROFIL_TRAVAIL);
		expect((await lancer(c, { profil: 'redaction', dossier: 'alpha' })).profil).toBe('redaction');
	});

	it('GET sessions?archivees=1 : les terminées aussi', async () => {
		const c = await serviceFaux();
		await c.etat.creer(sessionFixe(UUID, { etat: 'terminee', arretAttendu: 'abandon' }));
		expect((((await api(c).get(ROUTES.sessions)).corps as { sessions: SessionVue[] }).sessions)).toEqual([]);
		const archivees = (await api(c).get(`${ROUTES.sessions}?archivees=1`)).corps as { sessions: SessionVue[] };
		expect(archivees.sessions.map((s) => [s.id, s.etat, s.terminal])).toEqual([[UUID, 'terminee', false]]);
	});

	it('POST pause puis reprise (--resume), bilan (consigne tapée), abandon (terminée) ; 404 si inconnue', async () => {
		const c = await serviceFaux();
		const vue = await lancer(c);
		const pause = await api(c).post(chemin(ROUTES.pause, vue.id));
		expect(pause.statut).toBe(200);
		expect((pause.corps as { session: SessionVue }).session).toMatchObject({ etat: 'en_pause', terminal: false });

		const reprise = await api(c).post(chemin(ROUTES.reprise, vue.id));
		expect(reprise.statut).toBe(200);
		expect((reprise.corps as { session: SessionVue }).session).toMatchObject({ terminal: true });
		expect(c.terminaux.lances).toHaveLength(2);
		expect(c.terminaux.lances[1]!.options.args).toContain('--resume');

		const bilan = await api(c).post(chemin(ROUTES.bilan, vue.id));
		expect(bilan.statut).toBe(200);
		expect((bilan.corps as { session: SessionVue }).session.bilanDemandeMs).toEqual(expect.any(Number));
		expect(c.terminaux.lances[1]!.ecrits.join('')).toMatch(/Mnemo : bilan/u);

		const abandon = await api(c).post(chemin(ROUTES.abandon, vue.id));
		expect(abandon.statut).toBe(200);
		expect((abandon.corps as { session: SessionVue }).session).toMatchObject({ etat: 'terminee' });

		for (const route of [ROUTES.pause, ROUTES.reprise, ROUTES.bilan, ROUTES.abandon]) expect((await api(c).post(chemin(route, UUID))).statut).toBe(404);
	});

	it('GET servis : le journal de ce qui a été servi à la session', async () => {
		const c = await serviceFaux();
		await c.etat.creer(sessionFixe(UUID));
		const classement = [{ id: 'projets/alpha/alpha.md', titre: 'Alpha', note: 0.87, servi: true, rang: 1 }];
		await c.etat.journaliser({ session: UUID, moment: 'debut', horodatageMs: 5, ids: ['projets/alpha/alpha.md'], texte: 'Contexte', ms: 12, sens: false, demande: 'secret', classement, muet: null, cartes: [], position: null });
		const r = await api(c).get(chemin(ROUTES.servis, UUID));
		expect(r.statut).toBe(200);
		// la demande reste dans l'état (trace des écartés) : la vue ne la montre pas
		expect(r.corps).toEqual({ servis: [{ session: UUID, moment: 'debut', horodatageMs: 5, ids: ['projets/alpha/alpha.md'], texte: 'Contexte', ms: 12, sens: false, classement, muet: null, cartes: [], titres: { 'projets/alpha/alpha.md': 'alpha' } }], lues: [], coupures: [] });
		expect((await api(c).get(chemin(ROUTES.servis, '22222222-2222-4333-8444-555555555555'))).statut).toBe(404);
	});

	it('GET servis : lues non vide, la plus récente d’abord, sans doublon, avec l’heure de la dernière lecture ; titre des cartes à défaut d’index : nom du fichier', async () => {
		const c = await serviceFaux();
		await c.etat.creer(sessionFixe(UUID));
		for (const [chemin, horodatageMs] of [['a.md', 1], ['b.md', 2], ['a.md', 3]] as const) await c.etat.noterFicheServieLueOuEcrite(UUID, { chemin, action: 'lue', horodatageMs, empreinte: null });
		await c.etat.journaliser({ session: UUID, moment: 'message', horodatageMs: 5, ids: [], texte: '', ms: 1, sens: false, demande: null, classement: [], muet: null, cartes: [{ chemin: 'projets/alpha/Plan.md', raison: 'nommee' }], position: null });
		const corps = (await api(c).get(chemin(ROUTES.servis, UUID))).corps as { servis: { cartes: unknown[] }[]; lues: unknown[] };
		// chaque lue avec l'heure de sa dernière lecture
		expect(corps.lues).toEqual([
			{ chemin: 'a.md', horodatageMs: 3 },
			{ chemin: 'b.md', horodatageMs: 2 },
		]);
		expect(corps.servis[0]!.cartes).toEqual([{ id: 'projets/alpha/Plan.md', titre: 'Plan', raison: 'nommee' }]);
	});

	it('GET servis : seule la dernière entrée porte son classement (le panneau n’affiche qu’elle)', async () => {
		const c = await serviceFaux();
		await c.etat.creer(sessionFixe(UUID));
		const classement = [{ id: 'projets/alpha/alpha.md', titre: 'Alpha', note: null, servi: true, rang: 1 }];
		for (const h of [5, 6, 7]) await c.etat.journaliser({ session: UUID, moment: 'message', horodatageMs: h, ids: [], texte: 't', ms: 1, sens: false, demande: null, classement, muet: null, cartes: [], position: null });
		const { servis } = (await api(c).get(chemin(ROUTES.servis, UUID))).corps as { servis: { horodatageMs: number; classement: unknown[] }[] };
		expect(servis.map((e) => [e.horodatageMs, e.classement.length])).toEqual([
			[7, 1],
			[6, 0],
			[5, 0],
		]);
	});
});

describe('routes : historique et retrait d’une session terminée', () => {
	const AUTRE = '22222222-2222-4333-8444-555555555555';
	const episode = (session: string, titre: string, minimal = false) =>
		`---\nid: 01EP${session.slice(0, 4)}\ntype: episode\nupdated: 2026-11-20\nsession: ${session}\n${minimal ? 'minimal: true\n' : ''}---\n# ${titre}\n`;

	it('GET historique : les sessions terminées, plus récentes d’abord, avec leur épisode (bilan) s’il existe', async () => {
		const c = await serviceFaux();
		await c.etat.creer(sessionFixe(UUID, { etat: 'terminee', arretAttendu: 'bilan', majMs: 5000 }));
		await c.etat.creer(sessionFixe(AUTRE, { etat: 'terminee', arretAttendu: 'abandon', majMs: 9000, projet: 'beta' }));
		await c.etat.creer(sessionFixe('33333333-2222-4333-8444-555555555555', { etat: 'attend' }));
		await c.dep.coffre.ecrire('episodes/alpha/2026-11-20-catalogue.md', episode(UUID, 'Refonte du catalogue'));
		const r = await api(c).get(ROUTES.historique);
		expect(r.statut).toBe(200);
		const { sessions } = r.corps as { sessions: (SessionVue & { episode: unknown })[] };
		expect(sessions.map((x) => [x.id, x.etat, x.episode])).toEqual([
			[AUTRE, 'terminee', null],
			[UUID, 'terminee', { chemin: 'episodes/alpha/2026-11-20-catalogue.md', titre: 'Refonte du catalogue', minimal: false }],
		]);
	});

	it('DELETE session terminée : état (session, servis, écartés, traces) et plugin supprimés ; mémoire et configuration de Claude intactes', async () => {
		const claude = join(await dossierTemporaire(), 'config-claude');
		const transcription = join(claude, 'projects', '-alpha', `${UUID}.jsonl`);
		await mkdir(dirname(transcription), { recursive: true });
		await writeFile(transcription, '{"type":"user"}\n');
		const c = await serviceFaux({}, { dossierClaude: claude });
		await c.etat.creer(sessionFixe(UUID, { etat: 'attend' }));
		await c.etat.journaliser({ session: UUID, moment: 'debut', horodatageMs: 5, ids: ['projets/alpha/alpha.md'], texte: 't', ms: 1, sens: false, demande: null, classement: [{ id: 'projets/alpha/alpha.md', titre: 'Alpha', note: null, servi: true, rang: 1 }], muet: null, cartes: [], position: null });
		await c.etat.ecarter(UUID, { id: 'projets/alpha/alpha.md', titre: 'Alpha' }, { dossier: 'alpha', demande: null, horodatageMs: 6 });
		const plugin = await ecrirePlugin(c.racine, UUID, [{ chemin: 'consigne.md', texte: 'x' }]);
		await c.dep.coffre.ecrire('episodes/alpha/2026-11-20-catalogue.md', episode(UUID, 'Refonte du catalogue'));

		// session active : refusée, rien ne bouge
		const refus = await api(c).supprimer(chemin(ROUTES.session, UUID));
		expect(refus.statut).toBe(409);
		expect(refus.corps).toEqual({ erreur: expect.any(String) });
		expect(await c.etat.lire(UUID)).not.toBeNull();
		await access(plugin);

		await c.etat.modifier(UUID, { etat: 'terminee' });
		const r = await api(c).supprimer(chemin(ROUTES.session, UUID));
		expect(r.statut).toBe(200);
		expect(r.corps).toEqual({ id: UUID });
		expect(await c.etat.lire(UUID)).toBeNull();
		expect(await c.etat.servis(UUID, 10)).toEqual([]);
		await expect(access(plugin)).rejects.toThrow();
		const base = new DatabaseSync(join(c.racine, '.mnemo', 'etat.sqlite'));
		const traces = base.prepare('SELECT COUNT(*) AS n FROM traces_ecartes').get() as { n: number };
		base.close();
		expect(traces.n).toBe(0);
		// jamais touchés : l'épisode écrit dans la mémoire, les fiches, la transcription de Claude Code
		expect(await c.dep.coffre.lire('episodes/alpha/2026-11-20-catalogue.md')).toContain('Refonte du catalogue');
		expect(await c.dep.coffre.lire('projets/alpha/alpha.md')).toContain('# Alpha');
		expect(await readFile(transcription, 'utf8')).toBe('{"type":"user"}\n');

		expect((await api(c).supprimer(chemin(ROUTES.session, UUID))).statut).toBe(404);
		expect((await api(c).supprimer(chemin(ROUTES.session, 'pas-un-uuid'))).statut).toBe(404);
	});

	it('DELETE session terminée dont le terminal tourne encore ici : 409', async () => {
		const c = await serviceFaux();
		const vue = await lancer(c);
		await c.etat.modifier(vue.id, { etat: 'terminee' });
		expect((await api(c).supprimer(chemin(ROUTES.session, vue.id))).statut).toBe(409);
		expect(await c.etat.lire(vue.id)).not.toBeNull();
	});
});

describe('routes : écartés', () => {
	const ecartes = (id: string) => `${chemin(ROUTES.ecartes, UUID)}${id === '' ? '' : `?id=${encodeURIComponent(id)}`}`;
	async function avecClassement(c: ContexteService) {
		await c.etat.creer(sessionFixe(UUID, { dossier: 'code/alpha' }));
		await c.etat.noterMessagePorteur(UUID, 'Où en est Alpha ?');
		const classement = [
			{ id: 'projets/alpha/alpha.md', titre: 'Alpha', note: 0.87, servi: true, rang: 1 },
			{ id: 'projets/beta/beta.md#^f-0001', titre: 'Beta', note: 0.2, servi: false, rang: 2 },
		];
		await c.etat.journaliser({ session: UUID, moment: 'message', horodatageMs: 5, ids: ['projets/alpha/alpha.md'], texte: 'Contexte', ms: 12, sens: false, demande: 'Où en est Alpha ?', classement, muet: null, cartes: [], position: null });
	}

	it('POST écarte un élément du classement (titre repris, trace notée), GET les liste, DELETE rétablit', async () => {
		const c = await serviceFaux();
		await avecClassement(c);
		const r = await api(c).post(chemin(ROUTES.ecartes, UUID), { id: 'projets/beta/beta.md#^f-0001' });
		expect(r.statut).toBe(200);
		expect(r.corps).toEqual({ ecartes: [{ id: 'projets/beta/beta.md#^f-0001', titre: 'Beta', horodatageMs: expect.any(Number) }] });
		expect((await api(c).get(chemin(ROUTES.ecartes, UUID))).corps).toEqual(r.corps);
		const d = await api(c).supprimer(ecartes('projets/beta/beta.md#^f-0001'));
		expect(d.statut).toBe(200);
		expect(d.corps).toEqual({ ecartes: [] });
		// gestes : la fiche de l'élément, avec le dernier message porteur
		expect(await c.etat.gestes({ limite: null })).toMatchObject([
			{ geste: 'retablie', origine: 'utilisateur', fiche: 'projets/beta/beta.md', dossier: 'code/alpha', message: 'Où en est Alpha ?', rangMessage: 1 },
			{ geste: 'ecartee_ici', origine: 'utilisateur', fiche: 'projets/beta/beta.md', dossier: 'code/alpha', message: 'Où en est Alpha ?', rangMessage: 1 },
		]);
	});

	it('un geste par vrai changement : écarter deux fois n’en note qu’un ; rétablir un élément non écarté n’en note aucun', async () => {
		const c = await serviceFaux();
		await avecClassement(c);
		expect((await api(c).supprimer(ecartes('projets/alpha/alpha.md'))).statut).toBe(200);
		expect(await c.etat.gestes({ limite: null })).toEqual([]);
		expect((await api(c).post(chemin(ROUTES.ecartes, UUID), { id: 'projets/alpha/alpha.md' })).statut).toBe(200);
		expect((await api(c).post(chemin(ROUTES.ecartes, UUID), { id: 'projets/alpha/alpha.md' })).statut).toBe(200);
		expect((await c.etat.gestes({ limite: null })).map((g) => g.geste)).toEqual(['ecartee_ici']);
	});

	it('écart : le message est celui de l’entrée où la carte a été trouvée, même si un message porteur l’a suivie', async () => {
		const c = await serviceFaux();
		await avecClassement(c);
		await c.etat.noterMessagePorteur(UUID, 'Et Beta ?');
		await api(c).post(chemin(ROUTES.ecartes, UUID), { id: 'projets/alpha/alpha.md' });
		expect(await c.etat.gestes({ limite: null })).toMatchObject([{ geste: 'ecartee_ici', message: 'Où en est Alpha ?', rangMessage: 1 }]);
	});

	it('POST écarte une carte d’une nouvelle entrée (classement vide) : titre repris, trace notée', async () => {
		const c = await serviceFaux();
		await c.etat.creer(sessionFixe(UUID, { dossier: 'code/alpha' }));
		await c.etat.journaliser({ session: UUID, moment: 'message', horodatageMs: 5, ids: [], texte: '', ms: 1, sens: false, demande: 'Où en est Plan ?', classement: [], muet: null, cartes: [{ chemin: 'projets/alpha/Plan.md', raison: 'question', note: 0.64 }], position: null });
		const r = await api(c).post(chemin(ROUTES.ecartes, UUID), { id: 'projets/alpha/Plan.md' });
		expect(r.statut).toBe(200);
		expect(r.corps).toEqual({ ecartes: [{ id: 'projets/alpha/Plan.md', titre: 'Plan', horodatageMs: expect.any(Number) }] });
		expect((await c.etat.ecartes(UUID)).map((e) => e.id)).toEqual(['projets/alpha/Plan.md']);
		// la note de la carte au moment du geste
		expect(await c.etat.gestes({ limite: null })).toMatchObject([{ geste: 'ecartee_ici', fiche: 'projets/alpha/Plan.md', note: { note: 0.64 }, message: 'Où en est Plan ?', rangMessage: 0 }]);
	});

	it('refus : id absent des classements récents (404), corps invalide (400), session inconnue (404) ou terminée (409)', async () => {
		const c = await serviceFaux();
		await avecClassement(c);
		expect((await api(c).post(chemin(ROUTES.ecartes, UUID), { id: 'inconnu.md' })).statut).toBe(404);
		expect((await api(c).post(chemin(ROUTES.ecartes, UUID), { id: 3 })).statut).toBe(400);
		expect((await api(c).post(chemin(ROUTES.ecartes, UUID), {})).statut).toBe(400);
		expect((await api(c).supprimer(ecartes(''))).statut).toBe(400);
		expect((await api(c).post(chemin(ROUTES.ecartes, '22222222-2222-4333-8444-555555555555'), { id: 'projets/alpha/alpha.md' })).statut).toBe(404);
		await c.etat.modifier(UUID, { etat: 'terminee' });
		expect((await api(c).post(chemin(ROUTES.ecartes, UUID), { id: 'projets/alpha/alpha.md' })).statut).toBe(409);
		expect((await api(c).supprimer(ecartes('projets/alpha/alpha.md'))).statut).toBe(409);
		// aucun échec n'est noté comme un geste
		expect(await c.etat.gestes({ limite: null })).toEqual([]);
	});
});

describe('routes : injection automatique (suivi et réactivation)', () => {
	const T = Date.parse('2026-11-25T11:00:00.000Z');
	/** Un modèle Sens seul accepté, appris avant 17 injections automatiques toutes écartées : le niveau est coupé. */
	async function coupee() {
		const c = await serviceFaux();
		await c.etat.creer(sessionFixe(UUID));
		const sens = { ...modeleNonAppris(), apprisLe: '2026-11-25T10:00:00.000Z', refus: [], accepte: true, echelle: echelleDesSignaux(c.dep.reglages().contexte), biais: 3, poids: { cosinusRelatif: 0 } };
		c.dep.note = () => ({ coefficients: { complets: modeleNonAppris(), sens }, installes: { sens: null, reranker: null } });
		for (let i = 0; i < 17; i++) {
			await c.etat.noterGeste({ geste: 'injectee_auto', session: UUID, fiche: `n${i}.md`, empreinte: null, horodatageMs: T + i, note: { niveau: 'sens' } });
			await c.etat.noterGeste({ geste: 'ecartee_ici', session: UUID, fiche: `n${i}.md`, empreinte: null, horodatageMs: T + 100 + i, note: null });
		}
		return c;
	}
	const COUPURE = { niveau: 'sens', injections: 17, ecartees: 17, depuisMs: T + 116, motif: '17 des 17 dernières fiches injectées par Mnemo ont été écartées' };

	it('GET et `servis` disent la coupure ; POST la réactive (geste noté dans la session), une seconde fois sans geste', async () => {
		const c = await coupee();
		expect((await api(c).get(ROUTES.injectionAutomatique)).corps).toEqual({ coupures: [COUPURE] });
		expect((await api(c).get(chemin(ROUTES.servis, UUID))).corps).toMatchObject({ coupures: [COUPURE] });
		const r = await api(c).post(ROUTES.injectionAutomatique, { session: UUID });
		expect(r.statut).toBe(200);
		expect(r.corps).toEqual({ coupures: [] });
		expect((await api(c).post(ROUTES.injectionAutomatique, { niveau: 'sens' })).corps).toEqual({ coupures: [] });
		expect((await c.etat.gestes({ sortes: ['injection_reactivee'], limite: null })).map((g) => [g.session, g.fiche, g.note?.['niveau']])).toEqual([[UUID, '', 'sens']]);
		expect((await api(c).get(chemin(ROUTES.servis, UUID))).corps).toMatchObject({ coupures: [] });
	});

	it('refus : niveau inconnu, champ inconnu (400), session inconnue (404) ; rien n’est réactivé', async () => {
		const c = await coupee();
		expect((await api(c).post(ROUTES.injectionAutomatique, { niveau: 'tout' })).statut).toBe(400);
		expect((await api(c).post(ROUTES.injectionAutomatique, { pirate: 1 })).statut).toBe(400);
		expect((await api(c).post(ROUTES.injectionAutomatique, { session: '22222222-2222-4333-8444-555555555555' })).statut).toBe(404);
		expect((await api(c).get(ROUTES.injectionAutomatique)).corps).toEqual({ coupures: [COUPURE] });
	});
});

describe('routes : hook, traces d’une injection automatique après la livraison de la réponse', () => {
	const AVOIRS = 'projets/alpha/avoirs.md';
	const PROMPT = 'montant exact des avoirs annulés en novembre';
	const sensParMots: Sens = {
		modele: () => 'mots@1',
		vecteurs: async (textes) => textes.map((t) => Float32Array.from([...['avoir', 'remise', 'catalogue'].map((m) => t.toLowerCase().split(m).length - 1), 0.01])),
	};
	/** Un service dont le modèle Sens accepté injecte Avoirs au message ; `porte` retient la lecture d'Avoirs pour l'injection. */
	async function service(porte?: Promise<void>) {
		const c = await serviceFaux();
		await c.etat.creer(sessionFixe(UUID));
		await c.dep.coffre.ecrire(AVOIRS, `---\nid: 01ABD\ntype: sujet\nupdated: 2026-11-01\n---\n# Avoirs\n\nUn avoir annule une facture.\n`);
		await synchroniser(c.dep, SANS_EXTRACTION);
		c.dep.sens = sensParMots;
		await vectoriser(c.dep, { budgetMs: 60_000, demarrer: true });
		const sens = { ...modeleNonAppris(), apprisLe: '2026-11-25T10:00:00.000Z', refus: [], accepte: true, echelle: echelleDesSignaux(c.dep.reglages().contexte), biais: -3, poids: { bm25Relatif: 6, cosinusRelatif: 0.5 } };
		c.dep.note = () => ({ coefficients: { complets: modeleNonAppris(), sens }, installes: { sens: null, reranker: null } });
		const lecture = { commencee: false };
		if (porte !== undefined) {
			const lire = c.dep.coffre.lire.bind(c.dep.coffre);
			c.dep.coffre.lire = async (ch) => {
				if (ch === AVOIRS) {
					lecture.commencee = true;
					await porte;
				}
				return lire(ch);
			};
		}
		return { c, lecture };
	}
	const corps = (c: ContexteService) => ({ evenement: 'message', prompt: PROMPT, session: UUID, horodatageMs: Date.now(), cwd: join(c.racine, 'alpha') });
	const servie = async (c: ContexteService) => (await c.etat.fichesServiesLuesOuEcrites(UUID)).some((f) => f.chemin === AVOIRS);

	it('réponse livrée : la trace « servie » et le geste `injectee_auto` sont écrits après elle', async () => {
		const { c } = await service();
		const r = await api(c).post(ROUTES.hook, corps(c));
		expect((r.corps as { contexte?: string }).contexte).toContain('Un avoir annule une facture.');
		expect(await jusqua(async () => (await c.etat.gestes({ sortes: ['injectee_auto'], limite: null })).length === 1 && (await servie(c)), 2000)).toBe(true);
	});

	it('connexion abandonnée avant la réponse : ni trace « servie » ni geste ; la fiche reste injectable', async () => {
		let ouvrir: () => void = () => {};
		const { c, lecture } = await service(new Promise<void>((r) => (ouvrir = r)));
		const { port, jeton } = c.service;
		const texte = JSON.stringify(corps(c));
		const req = request({ host: '127.0.0.1', port, path: ROUTES.hook, method: 'POST', agent: false, headers: { host: `127.0.0.1:${port}`, authorization: `Bearer ${jeton}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(texte) } });
		req.on('error', () => {});
		req.end(texte);
		expect(await jusqua(() => lecture.commencee, 3000)).toBe(true);
		req.destroy();
		await new Promise((r) => setTimeout(r, 50));
		ouvrir();
		await new Promise((r) => setTimeout(r, 500));
		expect(await c.etat.gestes({ sortes: ['injectee_auto'], limite: null })).toEqual([]);
		expect(await servie(c)).toBe(false);
		// le message suivant, livré : elle part
		const r = await api(c).post(ROUTES.hook, corps(c));
		expect((r.corps as { contexte?: string }).contexte).toContain('Un avoir annule une facture.');
	});
});

describe('routes : écartées toujours', () => {
	const ALPHA = 'projets/alpha/alpha.md';
	const UUID2 = '22222222-2222-4333-8444-555555555555';
	const UUID3 = '33333333-2222-4333-8444-555555555555';
	const retablir = (chemin: string) => `${ROUTES.ecarteesToujours}?chemin=${encodeURIComponent(chemin)}`;

	it('POST écarte toujours (geste noté dans la session), GET les liste, DELETE rétablit (geste noté dans la session de l’écart)', async () => {
		const c = await serviceFaux();
		await synchroniser(c.dep, SANS_EXTRACTION);
		await c.etat.creer(sessionFixe(UUID));
		const r = await api(c).post(ROUTES.ecarteesToujours, { chemin: ALPHA, session: UUID });
		expect(r.statut).toBe(200);
		expect(r.corps).toEqual({ ecarteesToujours: [{ chemin: ALPHA, titre: expect.any(String), horodatageMs: expect.any(Number) }] });
		expect((await api(c).get(ROUTES.ecarteesToujours)).corps).toEqual(r.corps);
		// une deuxième fois : rien ne change, aucun geste de plus
		expect((await api(c).post(ROUTES.ecarteesToujours, { chemin: ALPHA, session: UUID })).corps).toEqual(r.corps);
		expect((await c.etat.gestes({ limite: null })).map((g) => [g.geste, g.session, g.fiche])).toEqual([['ecartee_toujours', UUID, ALPHA]]);
		const d = await api(c).supprimer(retablir(ALPHA));
		expect(d.statut).toBe(200);
		expect(d.corps).toEqual({ ecarteesToujours: [] });
		expect((await c.etat.gestes({ limite: null })).map((g) => [g.geste, g.session])).toEqual([
			['retablie', UUID],
			['ecartee_toujours', UUID],
		]);
		expect(await c.etat.ecarteesToujours()).toEqual([{ fiche: ALPHA, session: UUID, horodatageMs: expect.any(Number), retablieMs: expect.any(Number) }]);
	});

	it('depuis une session terminée : accepté (réglage de la fiche), geste noté dans la session', async () => {
		const c = await serviceFaux();
		await synchroniser(c.dep, SANS_EXTRACTION);
		await c.etat.creer(sessionFixe(UUID, { etat: 'terminee' }));
		expect((await api(c).post(ROUTES.ecarteesToujours, { chemin: ALPHA, session: UUID })).statut).toBe(200);
		expect((await c.etat.gestes({ limite: null })).map((g) => [g.geste, g.session])).toEqual([['ecartee_toujours', UUID]]);
	});

	it('sans session : écartée et rétablie, sans geste', async () => {
		const c = await serviceFaux();
		await synchroniser(c.dep, SANS_EXTRACTION);
		expect((await api(c).post(ROUTES.ecarteesToujours, { chemin: ALPHA })).statut).toBe(200);
		expect(await c.etat.ecarteesToujours()).toEqual([{ fiche: ALPHA, session: null, horodatageMs: expect.any(Number), retablieMs: null }]);
		expect((await api(c).supprimer(retablir(ALPHA))).statut).toBe(200);
		expect(await c.etat.gestes({ limite: null })).toEqual([]);
	});

	it('refus : fiche inconnue (404), session inconnue (404), corps invalide (400), rétablir une fiche non écartée (404)', async () => {
		const c = await serviceFaux();
		await synchroniser(c.dep, SANS_EXTRACTION);
		await c.etat.creer(sessionFixe(UUID, { etat: 'terminee' }));
		expect((await api(c).post(ROUTES.ecarteesToujours, { chemin: 'inconnue.md' })).statut).toBe(404);
		expect((await api(c).post(ROUTES.ecarteesToujours, { chemin: ALPHA, session: UUID2 })).statut).toBe(404);
		expect((await api(c).post(ROUTES.ecarteesToujours, { chemin: 3 })).statut).toBe(400);
		expect((await api(c).post(ROUTES.ecarteesToujours, { chemin: ALPHA, pirate: 1 })).statut).toBe(400);
		expect((await api(c).supprimer(retablir(ALPHA))).statut).toBe(404);
		expect((await api(c).supprimer(ROUTES.ecarteesToujours)).statut).toBe(400);
		expect(await c.etat.ecarteesToujours()).toEqual([]);
	});

	it('suggestion après 3 sessions sur 2 jours : dans la vue de la session qui l’a écartée, retirée une fois écartée toujours', async () => {
		const c = await serviceFaux();
		await synchroniser(c.dep, SANS_EXTRACTION);
		const hier = Date.now() - 86_400_000 * 1.5;
		for (const [i, id] of [UUID2, UUID3].entries()) {
			await c.etat.creer(sessionFixe(id));
			await c.etat.noterGeste({ geste: 'ecartee_ici', session: id, fiche: ALPHA, empreinte: null, horodatageMs: hier + i });
		}
		await c.etat.creer(sessionFixe(UUID));
		await c.etat.journaliser({ session: UUID, moment: 'message', horodatageMs: 5, ids: [], texte: '', ms: 1, sens: false, demande: 'Où en est Alpha ?', classement: [{ id: ALPHA, titre: 'Alpha', note: 0.4, servi: false, rang: 1 }], muet: null, cartes: [], position: null });
		const vueDe = async (id: string) => ((await api(c).get(chemin(ROUTES.session, id))).corps as { session: SessionVue }).session;
		expect((await vueDe(UUID)).suggestionsEcarteeToujours).toBeUndefined();
		expect((await api(c).post(chemin(ROUTES.ecartes, UUID), { id: ALPHA })).statut).toBe(200);
		expect((await vueDe(UUID)).suggestionsEcarteeToujours).toEqual([{ chemin: ALPHA, sessions: 3, jours: 2 }]);
		expect((await vueDe(UUID2)).suggestionsEcarteeToujours).toEqual([{ chemin: ALPHA, sessions: 3, jours: 2 }]);
		// jamais appliquée seule
		expect(await c.etat.ecarteesToujours()).toEqual([]);
		await api(c).post(ROUTES.ecarteesToujours, { chemin: ALPHA, session: UUID });
		expect((await vueDe(UUID)).suggestionsEcarteeToujours).toBeUndefined();
		// rétablie : les écarts d'avant le rétablissement ne la font pas suggérer de nouveau
		expect((await api(c).supprimer(`${ROUTES.ecarteesToujours}?chemin=${encodeURIComponent(ALPHA)}`)).statut).toBe(200);
		expect((await vueDe(UUID)).suggestionsEcarteeToujours).toBeUndefined();
		expect((await vueDe(UUID2)).suggestionsEcarteeToujours).toBeUndefined();
	});
});

describe('routes : hook', () => {
	it('POST hook = traiterEvenement : état appliqué, contexte servi, journalisé', async () => {
		const c = await serviceFaux();
		await c.etat.creer(sessionFixe(UUID, { objectif: null }));
		const r = await api(c).post(ROUTES.hook, { evenement: 'message', session: UUID, horodatageMs: Date.now(), cwd: join(c.racine, 'alpha'), prompt: 'Où en est Alpha ?' });
		expect(r.statut).toBe(200);
		expect(r.corps).toEqual(expect.any(Object));
		const s = await c.etat.lire(UUID);
		expect(s).toMatchObject({ etat: 'travaille', objectif: 'Où en est Alpha ?' });
	});

	it('POST hook message : le classement est affiné après la réponse (reranker en marche) ; jamais pour apres_outil, ni reranker arrêté', async () => {
		const c = await serviceFaux();
		for (const nom of ['tarifs', 'remises', 'devis']) {
			await c.dep.coffre.ecrire(`projets/alpha/${nom}.md`, `---\nid: 01${nom.toUpperCase()}\ntype: note\nupdated: 2026-11-01\n---\n# Catalogue ${nom}\n\nLes ${nom} du catalogue Alpha.\n`);
		}
		await synchroniser(c.dep, SANS_EXTRACTION);
		await c.etat.creer(sessionFixe(UUID, { objectif: null }));
		const appels: { textes: number; operation: string | undefined; demarrer: boolean }[] = [];
		let liberer = (): void => {};
		const bloque = new Promise<void>((r) => (liberer = r));
		c.dep.reranker = {
			noter: async (_requete, textes, o) => {
				appels.push({ textes: textes.length, operation: o.activite?.operation, demarrer: o.demarrer });
				await bloque;
				return textes.map((_t, i) => (i === textes.length - 1 ? 5 : -1));
			},
		};
		const entree = { session: UUID, cwd: join(c.racine, 'alpha') };
		// reranker arrêté : pas d'affinage
		await api(c).post(ROUTES.hook, { ...entree, evenement: 'message', horodatageMs: Date.now(), prompt: 'Où en est le catalogue Alpha ?' });
		await new Promise((r) => setTimeout(r, 100));
		expect((await c.etat.servis(UUID, 1))[0]!.affinage).toBeUndefined();
		c.modeles.vue = { ...c.modeles.vue, reranker: 'pret' };
		const h = Date.now();
		// la réponse part pendant que le reranker de l'affinage attend
		expect((await api(c).post(ROUTES.hook, { ...entree, evenement: 'message', horodatageMs: h, prompt: 'Où en est le catalogue Alpha ?' })).statut).toBe(200);
		expect(await jusqua(async () => (await c.etat.servis(UUID, 1))[0]!.affinage === 'en_cours', 2000)).toBe(true);
		expect(appels.at(-1)).toMatchObject({ operation: 'injection', demarrer: false });
		liberer();
		expect(await jusqua(async () => (await c.etat.servis(UUID, 1))[0]!.affinage === 'fait', 2000)).toBe(true);
		// peu de candidates : un seul morceau
		const avant = appels.length;
		expect(avant).toBe(1);
		const [affinee] = await c.etat.servis(UUID, 1);
		expect(affinee!.horodatageMs).toBe(h);
		expect(affinee!.classement[0]!.signaux).toMatchObject({ logit: 5 });
		// après un outil : rien d'affiné
		await api(c).post(ROUTES.hook, { ...entree, evenement: 'apres_outil', horodatageMs: Date.now(), outil: { nom: 'Read', entree: {} } });
		await new Promise((r) => setTimeout(r, 100));
		expect(appels.length).toBe(avant);
	});

	it('POST hook message : un message porteur plus récent coupe l’affinage du précédent (caduc, sans état d’affinage) ; le sien est fait', async () => {
		const c = await serviceFaux();
		for (const nom of ['tarifs', 'remises', 'devis']) {
			await c.dep.coffre.ecrire(`projets/alpha/${nom}.md`, `---\nid: 01${nom.toUpperCase()}\ntype: note\nupdated: 2026-11-01\n---\n# Catalogue ${nom}\n\nLes ${nom} du catalogue Alpha.\n`);
		}
		await synchroniser(c.dep, SANS_EXTRACTION);
		await c.etat.creer(sessionFixe(UUID, { objectif: null }));
		c.modeles.vue = { ...c.modeles.vue, reranker: 'pret' };
		const liberes: (() => void)[] = [];
		let appels = 0;
		c.dep.reranker = {
			noter: async (_requete, textes) => {
				appels++;
				await new Promise<void>((r) => liberes.push(r));
				return textes.map((_t, i) => (i === 0 ? -3 : 2));
			},
		};
		const entree = { session: UUID, cwd: join(c.racine, 'alpha') };
		const h1 = Date.now();
		await api(c).post(ROUTES.hook, { ...entree, evenement: 'message', horodatageMs: h1, prompt: 'Où en est le catalogue Alpha ?' });
		expect(await jusqua(() => appels === 1, 2000)).toBe(true);
		const h2 = h1 + 1;
		await api(c).post(ROUTES.hook, { ...entree, evenement: 'message', horodatageMs: h2, prompt: 'Et les remises du catalogue Alpha ?' });
		expect(await jusqua(() => appels === 2, 2000)).toBe(true);
		for (const l of liberes) l();
		const message = async (h: number) => (await c.etat.servis(UUID, 5, 'message')).find((e) => e.horodatageMs === h)!;
		expect(await jusqua(async () => (await message(h2)).affinage === 'fait', 2000)).toBe(true);
		expect(await jusqua(async () => (await message(h1)).affinage === undefined, 2000)).toBe(true);
		expect((await message(h1)).classement.some((l) => l.signaux?.logit !== undefined)).toBe(false);
	});

	it('POST hook message : sens absent au hook, reranker arrêté : l’arrière-plan calcule le sens seul', async () => {
		const c = await serviceFaux();
		for (const nom of ['tarifs', 'remises', 'devis']) {
			await c.dep.coffre.ecrire(`projets/alpha/${nom}.md`, `---\nid: 01${nom.toUpperCase()}\ntype: note\nupdated: 2026-11-01\n---\n# Catalogue ${nom}\n\nLes ${nom} du catalogue Alpha.\n`);
		}
		const sens = fauxSens();
		c.dep.sens = sens;
		const gestes: GesteANoter[] = [];
		const noterGeste = c.etat.noterGeste.bind(c.etat);
		c.etat.noterGeste = async (g) => {
			gestes.push(g);
			return noterGeste(g);
		};
		await synchroniser(c.dep, SANS_EXTRACTION);
		await vectoriser(c.dep, { budgetMs: Infinity, demarrer: true });
		await c.etat.creer(sessionFixe(UUID, { objectif: null }));
		c.modeles.vue = { ...c.modeles.vue, sens: 'pret' };
		let reranker = 0;
		c.dep.reranker = { noter: async () => (reranker++, null) };
		// le hook n'a pas le sens (son appel échoue) ; l'arrière-plan, si
		const vecteurs = sens.vecteurs.bind(sens);
		let appelsDuMessage = 0;
		sens.vecteurs = async (textes, o) => (++appelsDuMessage === 1 ? null : vecteurs(textes, o));
		const h = Date.now();
		await api(c).post(ROUTES.hook, { session: UUID, cwd: join(c.racine, 'alpha'), evenement: 'message', horodatageMs: h, prompt: 'Les remises du catalogue Alpha ?' });
		const message = async () => (await c.etat.servis(UUID, 1, 'message'))[0]!;
		expect(await jusqua(async () => (await message()).affinage === 'fait', 2000)).toBe(true);
		expect(await message()).toMatchObject({ horodatageMs: h, sens: true });
		expect((await message()).classement[0]!.signaux?.cosinus).not.toBeNull();
		expect(reranker).toBe(0);
		// la mémoire des porteurs a reçu le classement affiné et le vecteur : un geste ✗ les reprend
		const affinee = (await message()).classement;
		expect((await api(c).post(chemin(ROUTES.ecartes, UUID), { id: affinee[0]!.id })).statut).toBe(200);
		expect(gestes).toHaveLength(1);
		expect(gestes[0]!.vecteur).not.toBeNull();
		expect(gestes[0]!.note).toMatchObject({ rang: 1, rangHook: expect.any(Number) });
	});

	it('POST hook message : la durée du hook au journal, depuis le démarrage de son processus (l’horodatage) ; un horodatage trop ancien : depuis l’appel ; `msService` depuis l’appel', async () => {
		const c = await serviceFaux();
		await c.etat.creer(sessionFixe(UUID, { objectif: null }));
		const entree = { evenement: 'message' as const, session: UUID, cwd: join(c.racine, 'alpha'), prompt: 'Où en est le catalogue Alpha ?' };
		expect((await api(c).post(ROUTES.hook, { ...entree, horodatageMs: Date.now() - 60_000 })).statut).toBe(200);
		expect((await api(c).post(ROUTES.hook, { ...entree, horodatageMs: Date.now() - 250 })).statut).toBe(200);
		const [recent, ancien] = await c.etat.servis(UUID, 2);
		expect(ancien!.ms).toBeLessThan(10_000);
		expect(recent!.ms).toBeGreaterThanOrEqual(250);
		// la durée vue du service, depuis l'appel qu'il a reçu : à part
		expect(recent!.msService).toBeLessThan(250);
		expect(recent!.msService).toBeGreaterThanOrEqual(0);
	});

	it('POST hook message : les modèles suivent le niveau de la session, relu à chaque hook (coupés : aucun appel au sens)', async () => {
		const c = await serviceFaux();
		const sens = fauxSens();
		c.dep.sens = sens;
		await c.dep.coffre.ecrire('projets/alpha/inventaire.md', `---\nid: 01ABD\ntype: sujet\nupdated: 2026-11-01\n---\n# Inventaire Alpha\n\nL'inventaire d'Alpha est fait chaque mois.\n`);
		await c.etat.creer(sessionFixe(UUID));
		const entree = { evenement: 'message' as const, session: UUID, cwd: join(c.racine, 'alpha'), prompt: 'Vérifie l’inventaire mensuel des machines du projet Alpha.' };
		// sans niveau propre : le sens est appelé pour le message
		expect((await api(c).post(ROUTES.hook, { ...entree, horodatageMs: Date.now() })).statut).toBe(200);
		expect(sens.appels).toHaveLength(1);
		// coupés pour la session, en cours de route : plus aucun appel, le contexte est injecté par les mots
		await c.etat.modifier(UUID, { niveauModeles: 'coupes' });
		const r = await api(c).post(ROUTES.hook, { ...entree, horodatageMs: Date.now() + 1 });
		expect(r.statut).toBe(200);
		expect(sens.appels).toHaveLength(1);
	});

	it('POST hook message : réponse qui n’arriverait pas avant l’échéance du hook → aucune fiche notée servie ; le calcul local du hook les sert', async () => {
		const c = await serviceFaux();
		await c.etat.creer(sessionFixe(UUID, { objectif: null }));
		const entree = { evenement: 'message' as const, session: UUID, horodatageMs: Date.now(), cwd: join(c.racine, 'alpha'), prompt: 'Où en est Alpha ?' };
		// le hook n'attend plus : le service, trop lent, ne rend rien et ne note rien
		const r = await api(c).post(ROUTES.hook, { ...entree, echeanceMs: Date.now() + 1 });
		expect(r.statut).toBe(200);
		expect(r.corps).toEqual({});
		expect((await c.etat.fichesServiesLuesOuEcrites(UUID)).filter((f) => f.derniereAction === 'servie')).toEqual([]);
		expect(await c.etat.servis(UUID, 5)).toEqual([]);
		// le hook se replie sur son calcul local (même état) : la fiche lui est servie
		const local = await traiterEvenement(c.dep, { etat: c.etat, depot: DEPOT_ABSENT }, { ...entree, horodatageMs: entree.horodatageMs + 1 }, { froid: 'si-budget', racine: c.racine });
		expect(local.contexte).toContain('(projets/alpha/alpha.md)');
		// échéance mal formée → 400
		for (const echeanceMs of ['x', Number.NaN, -1]) expect((await api(c).post(ROUTES.hook, { ...entree, echeanceMs })).statut, String(echeanceMs)).toBe(400);
	});

	it('POST hook outil : consigne vérifiée (racine et sansCasse donnés par le service) → refus', async () => {
		const c = await serviceFaux();
		await c.dep.coffre.ecrire(
			'consignes/env.md',
			'---\nid: C1\ntype: consigne\nupdated: 2026-11-01\nportee: globale\nniveau: verifiee\nrepetitions: []\nregle: { type: chemins_interdits, motifs: ["**/.env"] }\n---\n# Env\n\nNe touche jamais aux .env.\n',
		);
		// le hook outil lit l'index sans le synchroniser : une recherche le met à jour
		await synchroniser(c.dep, SANS_EXTRACTION);
		const entree = { evenement: 'outil', session: '', horodatageMs: Date.now(), cwd: join(c.racine, 'alpha'), outil: { nom: 'Write', entree: { file_path: join(c.racine, 'alpha', '.env'), content: 'x' } } };
		const r = await api(c).post(ROUTES.hook, entree);
		expect(r.statut).toBe(200);
		expect((r.corps as { refus?: string }).refus).toMatch(/consigne vérifiée/u);
		// action non lue par le hook (entrée trop grosse) : refusée, la cause est dite
		const nonLue = await api(c).post(ROUTES.hook, { ...entree, outil: { nonLue: 'entree_trop_grosse' } });
		expect(nonLue.statut).toBe(200);
		expect((nonLue.corps as { refus?: string }).refus).toBe(texteDuRefus({ refus: true, cause: 'entree_trop_grosse', detail: null }));
		expect((await api(c).post(ROUTES.hook, { ...entree, outil: { nonLue: 'autre' } })).statut).toBe(400);
	});

	it('POST hook fin : épisode minimal en arrière-plan, attendu par l’arrêt du service', async () => {
		const c = await serviceFaux();
		await c.etat.creer(sessionFixe(UUID));
		const r = await api(c).post(ROUTES.hook, { evenement: 'fin', session: UUID, horodatageMs: Date.now(), cwd: null });
		expect(r.statut).toBe(200);
		await c.service.arreter();
		expect(c.dep.commits.map((x) => x.message).join('\n')).toMatch(/episode/u);
		expect(await c.etat.lire(UUID)).toMatchObject({ etat: 'a_relire' });
	});

	it('POST hook : horodatage hors bornes (négatif, au-delà de maintenant + 60 s) → 400, état intact', async () => {
		const c = await serviceFaux();
		await c.etat.creer(sessionFixe(UUID));
		for (const horodatageMs of [1e300, -1, Date.now() + 120_000]) {
			const r = await api(c).post(ROUTES.hook, { evenement: 'message', session: UUID, horodatageMs, cwd: null, prompt: 'x' });
			expect(r.statut, String(horodatageMs)).toBe(400);
		}
		expect(await c.etat.lire(UUID)).toMatchObject({ etat: 'attend', majMs: 1000, objectif: 'Objectif' });
	});

	it('POST hook arret : cause notée (notification, stop) ; message sansContexte : état seulement, rien servi', async () => {
		const c = await serviceFaux();
		await c.etat.creer(sessionFixe(UUID, { objectif: null }));
		const maintenant = Date.now();
		expect((await api(c).post(ROUTES.hook, { evenement: 'arret', session: UUID, horodatageMs: maintenant - 3, cwd: null, arret: 'notification' })).statut).toBe(200);
		expect(await c.etat.lire(UUID)).toMatchObject({ etat: 'attend', dernierArret: 'notification' });
		await api(c).post(ROUTES.hook, { evenement: 'arret', session: UUID, horodatageMs: maintenant - 2, cwd: null, arret: 'stop' });
		expect(await c.etat.lire(UUID)).toMatchObject({ dernierArret: 'stop' });
		const r = await api(c).post(ROUTES.hook, { evenement: 'message', session: UUID, horodatageMs: maintenant - 1, cwd: join(c.racine, 'alpha'), prompt: 'Où en est Alpha ?', sansContexte: true });
		expect(r.statut).toBe(200);
		expect(r.corps).toEqual({});
		expect(await c.etat.lire(UUID)).toMatchObject({ etat: 'travaille', objectif: 'Où en est Alpha ?', dernierArret: null });
		expect(await c.etat.servis(UUID, 5)).toEqual([]);
		for (const corps of [{ arret: 'autre' }, { arret: 1 }, { sansContexte: 'oui' }]) {
			expect((await api(c).post(ROUTES.hook, { evenement: 'arret', session: UUID, horodatageMs: Date.now(), cwd: null, ...corps })).statut, JSON.stringify(corps)).toBe(400);
		}
	});

	it('POST hook : entrée mal formée → 400', async () => {
		const c = await serviceFaux();
		for (const corps of [{}, { evenement: 'inconnu', session: '', horodatageMs: 1, cwd: null }, { evenement: 'message', session: 3, horodatageMs: 1, cwd: null }, { evenement: 'message', session: '', horodatageMs: 'x', cwd: null }]) {
			expect((await api(c).post(ROUTES.hook, corps)).statut, JSON.stringify(corps)).toBe(400);
		}
	});
});

describe('routes : mémoire', () => {
	it('GET memoire/documents : état des sessions en erreur → documents rendus, dossiers non rattachés vides, avertissement', async () => {
		const c = await serviceFaux({}, {
			pil: (pil) => {
				pil.etat.dossiersNonRattaches = async () => {
					throw new Error('base occupée');
				};
			},
		});
		await c.dep.coffre.ecrire('sources/devis.md', '---\nid: S1\ntype: source\nupdated: 2026-11-10\nchemin: alpha/devis.pdf\n---\n# Devis\n');
		const r = await api(c).get(ROUTES.documents);
		expect(r.statut).toBe(200);
		expect(r.corps).toMatchObject({
			documents: [{ chemin: 'sources/devis.md' }],
			dossiersNonRattaches: [],
			avertissements: ['État des sessions illisible : dossiers non rattachés inconnus (base occupée).'],
		});
	});

	it('GET memoire/documents : fiches source où qu’elles soient rangées, plus récentes d’abord, avec leur état (à traiter, traité) et leur fichier ; toutes les fiches à traiter', async () => {
		const c = await serviceFaux();
		const source = (id: string, updated: string, plus: string, titre: string) => `---\nid: ${id}\ntype: source\nupdated: ${updated}\n${plus}---\n# ${titre}\n`;
		await c.dep.coffre.ecrire('sources/devis.md', source('S1', '2026-11-10', 'chemin: alpha/devis.pdf\n', 'Devis'));
		await c.dep.coffre.ecrire('sources/claude-code/notes.md', source('S2', '2026-11-21', 'a_traiter: true\n', 'Notes de Claude'));
		await c.dep.coffre.ecrire('sources/mails/fil.md', source('S3', '2026-11-15', 'chemin: alpha/fil.eml\n', 'Fil'));
		await c.dep.coffre.ecrire('projets/alpha/autre.md', source('S4', '2026-11-22', '', 'Hors des sources'));
		await c.dep.coffre.ecrire('projets/alpha/sujet.md', '---\nid: S5\ntype: sujet\nupdated: 2026-11-23\n---\n# Pas une source\n');
		const r = await api(c).get(ROUTES.documents);
		expect(r.statut).toBe(200);
		expect(r.corps).toEqual({
			documents: [
				{ chemin: 'projets/alpha/autre.md', titre: 'Hors des sources', document: null, date: '2026-11-22', aTraiter: false },
				{ chemin: 'sources/claude-code/notes.md', titre: 'Notes de Claude', document: null, date: '2026-11-21', aTraiter: true },
				{ chemin: 'sources/mails/fil.md', titre: 'Fil', document: 'alpha/fil.eml', date: '2026-11-15', aTraiter: false },
				{ chemin: 'sources/devis.md', titre: 'Devis', document: 'alpha/devis.pdf', date: '2026-11-10', aTraiter: false },
			],
			aTraiter: [{ chemin: 'sources/claude-code/notes.md', titre: 'Notes de Claude', document: null, date: '2026-11-21', aTraiter: true }],
			totalDocuments: 4,
			totalATraiter: 1,
			dossiersNonRattaches: [],
			avertissements: [],
		});
	});

	it('GET memoire/liste, memoire/element, recherche, voisins', async () => {
		const c = await serviceFaux();
		const liste = await api(c).get(`${ROUTES.memoireListe}?dossier=projets/alpha`);
		expect(liste.statut).toBe(200);
		expect(liste.corps).toMatchObject({ dossier: 'projets/alpha', ficheDossier: { chemin: 'projets/alpha/alpha.md' }, fiches: [] });
		expect((await api(c).get(ROUTES.memoireListe)).corps).toMatchObject({ dossier: '', sousDossiers: ['projets'] });
		expect((await api(c).get(`${ROUTES.memoireListe}?dossier=../x`)).statut).toBe(400);

		const element = await api(c).get(`${ROUTES.memoireElement}?id=${encodeURIComponent('projets/alpha/alpha.md')}`);
		expect(element.statut).toBe(200);
		expect(element.corps).toMatchObject({ chemin: 'projets/alpha/alpha.md', texte: expect.stringContaining('# Alpha') });
		expect((await api(c).get(`${ROUTES.memoireElement}?id=absente.md`)).statut).toBe(404);
		c.dep.fichiers.set('.git/config', '[core]\n');
		expect((await api(c).get(`${ROUTES.memoireElement}?id=.git/config`)).statut).toBe(404);
		expect((await api(c).get(`${ROUTES.memoireElement}?id=.GIT/config`)).statut).toBe(404);
		expect((await api(c).get(`${ROUTES.memoireListe}?dossier=.git`)).corps).toMatchObject({ fiches: [], sousDossiers: [] });
		expect((await api(c).get(ROUTES.memoireElement)).statut).toBe(400);

		const recherche = await api(c).get(`${ROUTES.recherche}?q=Alpha`);
		expect(recherche.statut).toBe(200);
		expect((recherche.corps as { trouves: { chemin: string }[] }).trouves.map((t) => t.chemin)).toContain('projets/alpha/alpha.md');
		expect((await api(c).get(`${ROUTES.recherche}?q=Alpha&dossier=projets`)).statut).toBe(200);
		expect((await api(c).get(ROUTES.recherche)).statut).toBe(400);

		const voisins = await api(c).get(`${ROUTES.voisins}?id=projets/alpha/alpha.md`);
		expect(voisins.statut).toBe(200);
		expect(voisins.corps).toMatchObject({ fiche: 'projets/alpha/alpha.md' });
		expect((await api(c).get(`${ROUTES.voisins}?id=absente.md`)).statut).toBe(404);
	});

	it('GET recherche ?rapide=1 : les mots seuls, aucun modèle appelé ; sinon sens et reranker, note du reranker par résultat', async () => {
		const c = await serviceFaux();
		await api(c).get(ROUTES.sante);
		const appels: string[] = [];
		c.dep.sens = {
			modele: () => {
				appels.push('sens');
				return null;
			},
			vecteurs: async () => {
				appels.push('vecteurs');
				return null;
			},
		};
		c.dep.reranker = {
			noter: async (_requete, textes) => {
				appels.push('reranker');
				return textes.map(() => 0); // note brute du reranker : 0 → 0,5 après la sigmoïde
			},
		};
		const rapide = await api(c).get(`${ROUTES.recherche}?q=Alpha&rapide=1`);
		expect(rapide.statut).toBe(200);
		expect(appels).toEqual([]);
		const trouvesRapides = (rapide.corps as { trouves: { chemin: string; note: number | null }[] }).trouves;
		expect(trouvesRapides.map((t) => t.chemin)).toContain('projets/alpha/alpha.md');
		expect(trouvesRapides.every((t) => t.note === null)).toBe(true);

		const complete = await api(c).get(`${ROUTES.recherche}?q=Alpha`);
		expect(complete.statut).toBe(200);
		expect(appels).toContain('sens');
		expect(appels).toContain('reranker');
		const alpha = (complete.corps as { trouves: { chemin: string; note: number | null }[] }).trouves.find((t) => t.chemin === 'projets/alpha/alpha.md');
		expect(alpha?.note).toBe(0.5);

		// validé comme les autres paramètres : 1 ou 0, rien d'autre
		expect((await api(c).get(`${ROUTES.recherche}?q=Alpha&rapide=0`)).statut).toBe(200);
		for (const valeur of ['oui', '', '2', 'true']) {
			const r = await api(c).get(`${ROUTES.recherche}?q=Alpha&rapide=${valeur}`);
			expect(r.statut).toBe(400);
			expect((r.corps as { erreur: string }).erreur).toMatch(/rapide/u);
		}
	});

	it('GET recherche ?limite= : borné comme l’outil chercher (1 à 50)', async () => {
		const c = await serviceFaux();
		expect((await api(c).get(`${ROUTES.recherche}?q=Alpha&limite=20`)).statut).toBe(200);
		for (const valeur of ['0', '51', 'dix', '2.5']) expect((await api(c).get(`${ROUTES.recherche}?q=Alpha&limite=${valeur}`)).statut).toBe(400);
	});

	it('GET recherche : la recherche de l’interface ne démarre jamais les modèles', async () => {
		const c = await serviceFaux();
		const demarrages: boolean[] = [];
		c.dep.sens = {
			modele: () => 'm@1',
			vecteurs: async (_textes, o) => {
				demarrages.push(o.demarrer);
				return null;
			},
		};
		c.dep.reranker = {
			noter: async (_r, textes, o) => {
				demarrages.push(o.demarrer);
				return textes.map(() => 0);
			},
		};
		expect((await api(c).get(`${ROUTES.recherche}?q=Alpha`)).statut).toBe(200);
		expect(demarrages.length).toBeGreaterThan(0);
		expect(demarrages.every((d) => d === false)).toBe(true);
	});

	it('GET recherche ?genre= : fiches hors documents, ou documents seuls, filtrés par le service (pas parmi les premiers)', async () => {
		const c = await serviceFaux();
		const source = (i: number) => `---\nid: 01S${i}\ntype: source\ntype_source: note\nupdated: 2026-11-01\n---\n# Note Alpha ${i}\n\nAlpha alpha alpha alpha, encore Alpha.\n`;
		for (let i = 0; i < 25; i++) await c.dep.coffre.ecrire(`sources/note-${i}.md`, source(i));
		const chemins = async (q: string) => ((await api(c).get(`${ROUTES.recherche}?q=Alpha&limite=20${q}`)).corps as { trouves: { chemin: string }[] }).trouves.map((t) => t.chemin);
		const tout = await chemins('');
		expect(tout.filter((x) => x.startsWith('sources/')).length).toBeGreaterThanOrEqual(19);
		expect(await chemins('&genre=fiche')).toEqual(['projets/alpha/alpha.md']);
		const documents = await chemins('&genre=document');
		expect(documents.length).toBeGreaterThan(0);
		expect(documents.every((x) => x.startsWith('sources/'))).toBe(true);
		expect((await api(c).get(`${ROUTES.recherche}?q=Alpha&genre=passage`)).statut).toBe(400);
	});

	it('GET recherche : une recherche complète plus récente de même clé (onglet:palette) abandonne la précédente (reranker jamais appelé pour elle) ; sans clé, jamais remplacée', async () => {
		const c = await serviceFaux();
		let ouvrir: () => void = () => {};
		const porte = new Promise<void>((r) => (ouvrir = r));
		let enAttente = 0;
		c.dep.sens = {
			modele: () => 'm@1',
			vecteurs: async () => {
				enAttente++;
				await porte;
				return null;
			},
		};
		const requetes: string[] = [];
		c.dep.reranker = {
			noter: async (r, textes) => {
				requetes.push(r);
				return textes.map(() => 0);
			},
		};
		const { port, jeton } = c.service;
		const entetes = { [ENTETE_REMPLACEMENT]: 'onglet-1:palette' };
		const premiere = appeler(port, 'GET', `${ROUTES.recherche}?q=Alpha`, { jeton, entetes });
		await jusqua(() => enAttente > 0, 3000);
		const seconde = appeler(port, 'GET', `${ROUTES.recherche}?q=alpha%20bis`, { jeton, entetes });
		// un autre onglet n'est pas touché
		const autre = appeler(port, 'GET', `${ROUTES.recherche}?q=Alpha%20autre`, { jeton, entetes: { [ENTETE_REMPLACEMENT]: 'onglet-2:palette' } });
		// même onglet, requête sans clé (outils, CLI) : jamais remplacée, ne remplace rien
		const graphe = appeler(port, 'GET', `${ROUTES.recherche}?q=Alpha%20graphe`, { jeton });
		await jusqua(() => enAttente > 3, 3000);
		ouvrir();
		expect((await premiere).statut).toBe(409);
		expect((await seconde).statut).toBe(200);
		expect((await autre).statut).toBe(200);
		expect((await graphe).statut).toBe(200);
		expect(requetes.sort()).toEqual(['Alpha autre', 'Alpha graphe', 'alpha bis']);
		expect((await appeler(port, 'GET', `${ROUTES.recherche}?q=Alpha`, { jeton, entetes: { [ENTETE_REMPLACEMENT]: 'pas valide !' } })).statut).toBe(400);
	});

	it('GET recherche : connexion fermée par le client → la recherche s’arrête (reranker jamais appelé)', async () => {
		const c = await serviceFaux();
		let ouvrir: () => void = () => {};
		const porte = new Promise<void>((r) => (ouvrir = r));
		let enAttente = 0;
		let finies = 0;
		c.dep.sens = {
			modele: () => 'm@1',
			vecteurs: async () => {
				enAttente++;
				await porte;
				finies++;
				return null;
			},
		};
		let notes = 0;
		c.dep.reranker = {
			noter: async (_r, textes) => {
				notes++;
				return textes.map(() => 0);
			},
		};
		const { port, jeton } = c.service;
		const req = request({ host: '127.0.0.1', port, path: `${ROUTES.recherche}?q=Alpha`, method: 'GET', agent: false, headers: { host: `127.0.0.1:${port}`, authorization: `Bearer ${jeton}` } });
		req.on('error', () => {});
		req.end();
		await jusqua(() => enAttente > 0, 3000);
		req.destroy();
		await new Promise((r) => setTimeout(r, 50));
		ouvrir();
		await jusqua(() => finies >= enAttente, 3000);
		await new Promise((r) => setTimeout(r, 100));
		expect(notes).toBe(0);
		// le service répond toujours aux suivantes
		expect((await api(c).get(`${ROUTES.recherche}?q=Alpha`)).statut).toBe(200);
		expect(notes).toBe(1);
	});

	it('POST proposer : validé, source utilisateur crue (niveau appliqué directement) ; refus → 400', async () => {
		const c = await serviceFaux();
		const fait = await api(c).post(ROUTES.proposer, {
			genre: 'fait',
			fiche: 'projets/alpha/alpha.md',
			texte: 'Le budget d’Alpha est de 10 000 €.',
			nature: 'declare',
			source: { ref: 'dit en séance', type: 'utilisateur' },
		});
		expect(fait.statut).toBe(200);
		expect(fait.corps).toMatchObject({ statut: 'ecrit', fiche: 'projets/alpha/alpha.md' });

		c.dep.fichiers.set('consignes/env.md', '---\nid: C1\ntype: consigne\nupdated: 2026-11-01\nportee: globale\nniveau: rappelee\nrepetitions: []\n---\n# Env\n\nNe touche jamais aux .env.\n');
		const niveau = await api(c).post(ROUTES.proposer, { genre: 'niveau', fiche: 'consignes/env.md', niveau: 'toujours', source: { ref: 'interface', type: 'utilisateur' } });
		expect(niveau.corps).toMatchObject({ statut: 'ecrit', aConfirmer: false });
		expect(c.dep.fichiers.get('consignes/env.md')).toMatch(/niveau: toujours/u);

		const invalide = await api(c).post(ROUTES.proposer, { genre: 'fait', fiche: 'projets/alpha/alpha.md' });
		expect(invalide.statut).toBe(400);
		expect(invalide.corps).toEqual({ erreur: expect.any(String) });
		const refuse = await api(c).post(ROUTES.proposer, { genre: 'fait', fiche: '../hors.md', texte: 'x', nature: 'declare', source: { ref: 'x', type: 'utilisateur' } });
		expect(refuse.statut).toBe(400);
	});

	it('POST proposer, deplacer et depot, index en panne après l\'écriture : succès (200, 201) avec l\'avertissement, journalisé', async () => {
		const c = await serviceFaux();
		c.dep.index.fiches = async () => {
			throw new Error('index cassé');
		};
		const av = avertissementIndex('index cassé');
		const fait = await api(c).post(ROUTES.proposer, { genre: 'fait', fiche: 'projets/alpha/alpha.md', texte: 'Le budget d’Alpha est de 10 000 €.', nature: 'declare', source: { ref: 'dit en séance', type: 'utilisateur' }, apresProches: true });
		expect(fait.statut, fait.texte).toBe(200);
		expect(fait.corps).toMatchObject({ statut: 'ecrit', avertissements: [av] });
		await c.dep.coffre.ecrire('projets/alpha/note.md', '---\nid: 01NOTE\ntype: sujet\nupdated: 2026-11-01\n---\n# Note\n');
		const d = await api(c).post(ROUTES.deplacer, { id: 'projets/alpha/note.md', dossier: 'archives' });
		expect(d.statut, d.texte).toBe(200);
		expect(d.corps).toMatchObject({ statut: 'ecrit', avertissements: [av] });
		const depot = await appeler(c.service.port, 'POST', `${ROUTES.depot}?vers=docs/cr.txt`, { jeton: c.service.jeton, corps: new TextEncoder().encode('Compte rendu.\n') });
		expect(depot.statut, depot.texte).toBe(201);
		expect(depot.corps).toEqual({ chemin: 'docs/cr.txt', avertissements: [expect.stringContaining('introuvable après le dépôt'), av] });
		expect(c.journal.filter((m) => m.includes(av))).toHaveLength(3);
	});

	it('POST deplacer ; GET fil', async () => {
		const c = await serviceFaux();
		await c.dep.coffre.ecrire('projets/alpha/note.md', '---\nid: 01NOTE\ntype: sujet\nupdated: 2026-11-01\n---\n# Note\n');
		const d = await api(c).post(ROUTES.deplacer, { id: 'projets/alpha/note.md', dossier: 'archives' });
		expect(d.statut, d.texte).toBe(200);
		expect(d.corps).toMatchObject({ statut: 'ecrit' });
		expect(c.dep.fichiers.has('archives/note.md')).toBe(true);
		expect((await api(c).post(ROUTES.deplacer, { id: 'x.md#^f-1', dossier: 'a' })).statut).toBe(400);

		const fil = await api(c).get(`${ROUTES.fil}?jour=2026-11-22`);
		expect(fil.statut).toBe(200);
		expect(fil.corps).toMatchObject({ commits: expect.any(Array), aConfirmer: expect.any(Array), montees: expect.any(Array) });
		expect((await api(c).get(ROUTES.fil)).statut).toBe(200);
		expect((await api(c).get(`${ROUTES.fil}?jour=hier`)).statut).toBe(400);
	});

	it('POST depot : fichier rangé (jamais écrasé : 409), chemins refusés (400) ; rien n’est tapé chez l’archiviste (consigne en fin de lot)', async () => {
		const c = await serviceFaux();
		const { port, jeton } = c.service;
		const deposer = (vers: string, contenu = 'Compte rendu du 21/11.\n') => appeler(port, 'POST', `${ROUTES.depot}?vers=${encodeURIComponent(vers)}`, { jeton, corps: new TextEncoder().encode(contenu) });

		const archiviste = await lancer(c, { profil: 'archiviste', dossier: '' });
		// les documents du faux service sont en mémoire : ils voient ce que le disque reçoit
		c.dep.documents.deposer('docs/cr.txt', 'Compte rendu du 21/11.\n');
		const premier = await deposer('docs/cr.txt');
		expect(premier.statut).toBe(201);
		expect(premier.corps).toEqual({ chemin: 'docs/cr.txt' });
		expect(await readFile(join(c.racine, 'docs', 'cr.txt'), 'utf8')).toBe('Compte rendu du 21/11.\n');
		const terminal = c.terminaux.lances.find((t) => t.options.env.MNEMO_SESSION === archiviste.id)!;
		expect(terminal.ecrits).toEqual([]);

		const encore = await deposer('docs/cr.txt', 'autre');
		expect(encore.statut).toBe(409);
		expect(await readFile(join(c.racine, 'docs', 'cr.txt'), 'utf8')).toBe('Compte rendu du 21/11.\n');

		for (const vers of ['../dehors.txt', '_mnemo/x.md', '.mnemo/x', '/tmp/x.txt', '', 'docs/a\u009b2J.txt', 'docs/\u202etxt.exe', 'docs/\u2066x\u2069.txt', 'docs/a\u0085.txt', 'docs/facture\u200e.pdf', 'docs/a\u200fb.txt', 'docs/a\u061cb.txt']) {
			const r = await deposer(vers);
			expect(r.statut, vers).toBe(400);
			expect(r.corps).toEqual({ erreur: expect.any(String) });
		}
		expect((await appeler(port, 'POST', ROUTES.depot, { jeton, corps: new Uint8Array(3) })).statut).toBe(400);
	});

	it('POST depot : un binaire sans extracteur est gardé, avec l’avertissement « ne sera pas cherchable » ; sa fiche le dit après l’indexation', async () => {
		const c = await serviceFaux();
		const { port, jeton } = c.service;
		const xlsx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);
		// les documents du faux service sont en mémoire : ils voient ce que le disque reçoit
		c.dep.documents.deposer('docs/compta.xlsx', xlsx);
		c.dep.documents.deposer('docs/tarifs.csv', 'poste;prix\n');
		const r = await appeler(port, 'POST', `${ROUTES.depot}?vers=docs/compta.xlsx`, { jeton, corps: xlsx });
		expect(r.statut).toBe(201);
		expect(r.corps).toEqual({ chemin: 'docs/compta.xlsx', avertissements: [expect.stringMatching(/« docs\/compta\.xlsx » : pas un fichier texte.*ne sera pas cherchable$/u)] });
		const csv = await appeler(port, 'POST', `${ROUTES.depot}?vers=docs/tarifs.csv`, { jeton, corps: new TextEncoder().encode('poste;prix\n') });
		expect(csv.corps).toEqual({ chemin: 'docs/tarifs.csv' });
		await synchroniser(c.dep);
		const fiche = await appeler(port, 'GET', `${ROUTES.fiche}?chemin=${encodeURIComponent('sources/compta.md')}`, { jeton });
		expect((fiche.corps as FicheVue).avertissements).toEqual([expect.stringContaining('ne sera pas cherchable')]);
	});

	it('route inconnue → 404 { erreur }', async () => {
		const c = await serviceFaux();
		const r = await api(c).get('/api/rien');
		expect(r.statut).toBe(404);
		expect(r.corps).toEqual({ erreur: expect.any(String) });
		expect((await api(c).post(ROUTES.sante)).statut).toBe(404);
	});
});
