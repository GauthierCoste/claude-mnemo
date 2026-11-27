import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { CODE_FERMETURE_LENT, ENTREE_MAX_OCTETS, MESSAGE_CLIENT_MAX_OCTETS, ROUTES } from '@mnemo/contrat';
import type { MessageClient, MessageServeur, SessionVue } from '@mnemo/contrat';
import type { Session } from '../../src/domaine/session.ts';
import { echelleDesSignaux, modeleNonAppris } from '../../src/domaine/modele-de-note.ts';
import { REGLAGES_PAR_DEFAUT } from '../../src/domaine/reglages.ts';
import { SANS_EXTRACTION, synchroniser } from '../../src/application/synchroniser.ts';
import { signalerGroupe } from '../../src/infra/processus.ts';
import { terminauxPty } from '../../src/infra/terminaux-pty.ts';
import { appeler, jusqua, serviceFaux } from '../aides/service-faux.ts';
import type { ContexteService } from '../aides/service-faux.ts';
import { commandeClaude } from '../aides/moteurs.ts';

const FAUX_CLAUDE = resolve(import.meta.dirname, '../aides/faux-claude.mjs');
const UUID = '11111111-2222-4333-8444-555555555555';

/** `queue` : fin de la sortie reçue (8 Ko), pour un client qui ne garde pas ses messages `sortie` (`sansSorties`). */
type Client = { ws: WebSocket; recus: MessageServeur[]; queue: string; recuSortie: number; envoyer(m: MessageClient): void; ferme: Promise<number> };

const clients: WebSocket[] = [];
const pids = new Set<number>();
afterEach(() => {
	while (clients.length > 0) clients.pop()!.terminate();
	for (const pid of pids) signalerGroupe(pid, 'SIGKILL', process.platform);
	pids.clear();
});

function connecter(c: ContexteService, options: { autoPong?: boolean; sansSorties?: boolean } = {}): Promise<Client> {
	return new Promise((resoudre, rejeter) => {
		const ws = new WebSocket(`ws://127.0.0.1:${c.service.port}${ROUTES.ws}?jeton=${c.service.jeton}`, { autoPong: options.autoPong ?? true });
		clients.push(ws);
		const ferme = new Promise<number>((r) => ws.once('close', (code) => r(code)));
		const client: Client = { ws, recus: [], queue: '', recuSortie: 0, envoyer: (m) => ws.send(JSON.stringify(m)), ferme };
		ws.on('message', (brut) => {
			const m = JSON.parse(String(brut)) as MessageServeur;
			if (m.type === 'sortie' || m.type === 'relecture') {
				client.queue = (client.queue + m.donnees).slice(-8192);
				client.recuSortie += m.donnees.length;
			}
			if (options.sansSorties !== true || m.type !== 'sortie') client.recus.push(m);
		});
		ws.once('open', () => resoudre(client));
		ws.once('error', rejeter);
	});
}

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

async function lancer(c: ContexteService): Promise<SessionVue> {
	const r = await appeler(c.service.port, 'POST', ROUTES.sessions, { jeton: c.service.jeton, corps: { profil: 'travail', dossier: 'alpha' } });
	expect(r.statut).toBe(201);
	return (r.corps as { session: SessionVue }).session;
}

describe('WebSocket : messages', () => {
	it('à la connexion, `sessions` d’abord ; puis `session` à chaque changement du pilote', async () => {
		const c = await serviceFaux();
		await c.etat.creer(sessionFixe(UUID));
		const client = await connecter(c);
		expect(await jusqua(() => client.recus.length > 0, 2000)).toBe(true);
		expect(client.recus[0]).toMatchObject({ type: 'sessions', sessions: [{ id: UUID, terminal: false }] });

		const vue = await lancer(c);
		expect(await jusqua(() => client.recus.some((m) => m.type === 'session' && m.session.id === vue.id && m.session.terminal), 2000)).toBe(true);
	});

	it('`session` aussi quand un hook passé hors service change etat.sqlite (lecture chaque seconde)', { timeout: 20_000 }, async () => {
		const c = await serviceFaux();
		await c.etat.creer(sessionFixe(UUID));
		const client = await connecter(c);
		await jusqua(() => client.recus.length > 0, 2000);
		await c.etat.appliquer(UUID, 'message', Date.now(), { objectif: 'Hors service' });
		expect(await jusqua(() => client.recus.some((m) => m.type === 'session' && m.session.id === UUID && m.session.etat === 'travaille'), 10_000)).toBe(true);
	});

	it('sondage : un changement hors service → exactement un message `session` (ni les autres, ni les archivées)', { timeout: 20_000 }, async () => {
		const ID_B = '22222222-2222-4333-8444-555555555555';
		const ID_T = '33333333-2222-4333-8444-555555555555';
		const c = await serviceFaux({ sondageMs: 100 }, {
			avant: async (etat) => {
				await etat.creer(sessionFixe(UUID, { etat: 'en_pause' }));
				await etat.creer(sessionFixe(ID_B, { etat: 'en_pause' }));
				await etat.creer(sessionFixe(ID_T, { etat: 'terminee', arretAttendu: 'abandon' }));
			},
		});
		const client = await connecter(c);
		await jusqua(() => client.recus.length > 0, 2000);
		await new Promise((r) => setTimeout(r, 500));
		const avant = client.recus.length;
		await c.etat.appliquer(UUID, 'message', Date.now(), { objectif: 'Hors service' });
		expect(await jusqua(() => client.recus.length > avant, 5000)).toBe(true);
		await new Promise((r) => setTimeout(r, 1500));
		const nouveaux = client.recus.slice(avant);
		expect(nouveaux).toHaveLength(1);
		expect(nouveaux[0]).toMatchObject({ type: 'session', session: { id: UUID, etat: 'travaille' } });
	});

	it('abonner → relecture (tampon) puis sortie ; entree et taille vont au terminal', async () => {
		const c = await serviceFaux();
		const vue = await lancer(c);
		const terminal = c.terminaux.lances[0]!;
		terminal.emettre('avant abonnement\r\n');
		const client = await connecter(c);
		client.envoyer({ type: 'abonner', session: vue.id });
		expect(await jusqua(() => client.recus.some((m) => m.type === 'relecture'), 2000)).toBe(true);
		expect(client.recus.find((m) => m.type === 'relecture')).toEqual({ type: 'relecture', session: vue.id, donnees: 'avant abonnement\r\n' });
		terminal.emettre('après');
		expect(await jusqua(() => client.recus.some((m) => m.type === 'sortie' && m.donnees === 'après'), 2000)).toBe(true);

		client.envoyer({ type: 'entree', session: vue.id, donnees: 'bonjour\r' });
		client.envoyer({ type: 'taille', session: vue.id, colonnes: 100, lignes: 40 });
		expect(await jusqua(() => terminal.ecrits.includes('bonjour\r') && terminal.tailles.some(([x, y]) => x === 100 && y === 40), 2000)).toBe(true);

		client.envoyer({ type: 'desabonner', session: vue.id });
		await new Promise((r) => setTimeout(r, 100));
		const avant = client.recus.length;
		terminal.emettre('plus pour lui');
		await new Promise((r) => setTimeout(r, 200));
		expect(client.recus.slice(avant).filter((m) => m.type === 'sortie')).toEqual([]);
	});

	it('trame `entree` : ENTREE_MAX_OCTETS octets UTF-8 au plus, acceptée même tout échappée en JSON ; au-delà, ignorée', async () => {
		// le pire échappement JSON (`\u0001` : six octets par octet) d'une trame pleine tient dans un message client
		expect(6 * ENTREE_MAX_OCTETS + 200).toBeLessThan(MESSAGE_CLIENT_MAX_OCTETS);
		const c = await serviceFaux();
		const vue = await lancer(c);
		const terminal = c.terminaux.lances[0]!;
		const client = await connecter(c);
		const pleine = '\u0001'.repeat(ENTREE_MAX_OCTETS);
		const accents = 'é'.repeat(ENTREE_MAX_OCTETS / 2);
		// 32 769 unités UTF-16, mais 65 538 octets UTF-8 : refusée
		const tropDOctets = 'é'.repeat(ENTREE_MAX_OCTETS / 2 + 1);
		client.envoyer({ type: 'entree', session: vue.id, donnees: pleine });
		client.envoyer({ type: 'entree', session: vue.id, donnees: tropDOctets });
		client.envoyer({ type: 'entree', session: vue.id, donnees: accents });
		client.envoyer({ type: 'entree', session: vue.id, donnees: 'fin' });
		expect(await jusqua(() => terminal.ecrits.includes('fin'), 2000)).toBe(true);
		expect(terminal.ecrits.map((e) => e.length)).toEqual([ENTREE_MAX_OCTETS, ENTREE_MAX_OCTETS / 2, 3]);
		expect(client.ws.readyState).toBe(WebSocket.OPEN);
	});

	it('messages invalides ignorés sans fermer la connexion', async () => {
		const c = await serviceFaux();
		const client = await connecter(c);
		client.ws.send('pas du json');
		client.ws.send(JSON.stringify({ type: 'inconnu' }));
		client.ws.send(JSON.stringify({ type: 'entree', session: UUID, donnees: 3 }));
		client.envoyer({ type: 'abonner', session: UUID });
		await new Promise((r) => setTimeout(r, 200));
		expect(client.ws.readyState).toBe(WebSocket.OPEN);
	});

	it('sondage : un `servi` journalisé hors service (hook en repli local) est diffusé une fois ; celui du service, pas deux fois', { timeout: 20_000 }, async () => {
		const c = await serviceFaux({ sondageMs: 100 }, { avant: async (etat) => etat.creer(sessionFixe(UUID)) });
		const client = await connecter(c);
		await jusqua(() => client.recus.length > 0, 2000);
		await new Promise((r) => setTimeout(r, 300));
		// le hook sans service : état et journal écrits directement dans etat.sqlite
		const maintenant = Date.now();
		await c.etat.appliquer(UUID, 'message', maintenant);
		await c.etat.journaliser({ session: UUID, moment: 'message', horodatageMs: maintenant, ids: ['projets/alpha/alpha.md'], texte: 'Contexte local.', ms: 12, sens: false, demande: null, classement: [], muet: null, cartes: [], position: null });
		expect(await jusqua(() => client.recus.some((m) => m.type === 'servi' && m.entree.texte === 'Contexte local.'), 5000)).toBe(true);
		await new Promise((r) => setTimeout(r, 500));
		expect(client.recus.filter((m) => m.type === 'servi')).toHaveLength(1);
		// servi par le service : diffusé par la route, le sondage ne le rediffuse pas
		await appeler(c.service.port, 'POST', ROUTES.hook, { jeton: c.service.jeton, corps: { evenement: 'message', prompt: 'alpha', session: UUID, horodatageMs: Date.now(), cwd: join(c.racine, 'alpha') } });
		expect(await jusqua(() => client.recus.filter((m) => m.type === 'servi').length === 2, 3000)).toBe(true);
		await new Promise((r) => setTimeout(r, 600));
		expect(client.recus.filter((m) => m.type === 'servi')).toHaveLength(2);
	});

	it('affinage : l’entrée du message rediffusée, complétée, avec le même horodatage', { timeout: 20_000 }, async () => {
		const c = await serviceFaux({}, { avant: async (etat) => etat.creer(sessionFixe(UUID)) });
		await c.dep.coffre.ecrire('projets/alpha/tarifs.md', `---\nid: 01TARIFS\ntype: note\nupdated: 2026-11-01\n---\n# Tarifs\n\nLes tarifs du catalogue Alpha.\n`);
		await synchroniser(c.dep, SANS_EXTRACTION);
		c.modeles.vue = { ...c.modeles.vue, reranker: 'pret' };
		c.dep.reranker = { noter: async (_r, textes) => textes.map(() => 3) };
		const client = await connecter(c);
		await jusqua(() => client.recus.length > 0, 2000);
		const h = Date.now();
		await appeler(c.service.port, 'POST', ROUTES.hook, { jeton: c.service.jeton, corps: { evenement: 'message', prompt: 'Les tarifs du catalogue Alpha ?', session: UUID, horodatageMs: h, cwd: join(c.racine, 'alpha') } });
		const servis = () => client.recus.flatMap((m) => (m.type === 'servi' ? [m.entree] : []));
		expect(await jusqua(() => servis().some((e) => e.affinage === 'fait'), 3000)).toBe(true);
		// l'entrée du hook, puis en cours, puis complétée : toujours la même entrée
		await new Promise((r) => setTimeout(r, 300));
		expect(servis().map((e) => e.horodatageMs)).toEqual(servis().map(() => h));
		expect(servis().map((e) => e.affinage ?? null)).toEqual([null, 'en_cours', 'fait']);
	});

	it('affinage : une entrée d’après un outil arrivée pendant le reranker ne le rend pas caduc ; l’entrée du message est écrite et diffusée', { timeout: 20_000 }, async () => {
		const c = await serviceFaux({}, { avant: async (etat) => etat.creer(sessionFixe(UUID)) });
		await c.dep.coffre.ecrire('projets/alpha/tarifs.md', `---\nid: 01TARIFS\ntype: note\nupdated: 2026-11-01\n---\n# Tarifs\n\nLes tarifs du catalogue Alpha.\n`);
		await synchroniser(c.dep, SANS_EXTRACTION);
		c.modeles.vue = { ...c.modeles.vue, reranker: 'pret' };
		let liberer = (): void => {};
		const bloque = new Promise<void>((r) => (liberer = r));
		let appele = false;
		c.dep.reranker = {
			noter: async (_r, textes) => {
				appele = true;
				await bloque;
				return textes.map(() => 3);
			},
		};
		const client = await connecter(c);
		await jusqua(() => client.recus.length > 0, 2000);
		const h = Date.now();
		await appeler(c.service.port, 'POST', ROUTES.hook, { jeton: c.service.jeton, corps: { evenement: 'message', prompt: 'Les tarifs du catalogue Alpha ?', session: UUID, horodatageMs: h, cwd: join(c.racine, 'alpha') } });
		expect(await jusqua(() => appele, 2000)).toBe(true);
		// Claude enchaîne un outil : une entrée d'après l'outil, plus récente, est journalisée pendant le reranker
		await c.etat.journaliser({ session: UUID, moment: 'apres_outil', horodatageMs: h + 1, ids: ['projets/alpha/alpha.md'], texte: 'Après outil.', ms: 1, sens: false, demande: null, classement: [], muet: null, cartes: [], position: null });
		liberer();
		const servis = () => client.recus.flatMap((m) => (m.type === 'servi' ? [m.entree] : []));
		expect(await jusqua(() => servis().some((e) => e.affinage === 'fait'), 3000)).toBe(true);
		expect(servis().find((e) => e.affinage === 'fait')).toMatchObject({ horodatageMs: h });
		expect((await c.etat.servis(UUID, 1, 'message'))[0]).toMatchObject({ horodatageMs: h, affinage: 'fait' });
	});

	it('la trace d’un /clear au journal n’est jamais diffusée ni rendue par GET servis', { timeout: 20_000 }, async () => {
		const c = await serviceFaux({ sondageMs: 100 }, { avant: async (etat) => etat.creer(sessionFixe(UUID)) });
		const client = await connecter(c);
		await jusqua(() => client.recus.length > 0, 2000);
		await appeler(c.service.port, 'POST', ROUTES.hook, { jeton: c.service.jeton, corps: { evenement: 'debut', source: 'clear', session: UUID, horodatageMs: Date.now(), cwd: join(c.racine, 'alpha') } });
		expect((await c.etat.servis(UUID, 1))[0]).toMatchObject({ moment: 'debut' });
		await new Promise((r) => setTimeout(r, 500));
		expect(client.recus.filter((m) => m.type === 'servi')).toEqual([]);
		const r = await appeler(c.service.port, 'GET', ROUTES.servis.replace(':id', UUID), { jeton: c.service.jeton });
		expect((r.corps as { servis: unknown[] }).servis).toEqual([]);
	});

	it('sondage : une carte journalisée hors service porte le titre de l\'index (pas le nom du fichier)', { timeout: 20_000 }, async () => {
		const c = await serviceFaux({ sondageMs: 100 }, { avant: async (etat) => etat.creer(sessionFixe(UUID)) });
		c.dep.index.titres = async () => [{ chemin: 'projets/alpha/alpha.md', titre: 'Projet Alpha complet', alias: [] }];
		const client = await connecter(c);
		await jusqua(() => client.recus.length > 0, 2000);
		const maintenant = Date.now();
		await c.etat.appliquer(UUID, 'message', maintenant);
		await c.etat.journaliser({ session: UUID, moment: 'message', horodatageMs: maintenant, ids: [], texte: '', ms: 3, sens: false, demande: null, classement: [], muet: null, cartes: [{ chemin: 'projets/alpha/alpha.md', raison: 'question' }], position: null });
		expect(await jusqua(() => client.recus.some((m) => m.type === 'servi' && m.entree.cartes.some((x) => x.titre === 'Projet Alpha complet')), 5000)).toBe(true);
	});

	it('`ecartes` diffusé quand un élément est écarté puis rétabli ; `servi` porte les cartes', async () => {
		const c = await serviceFaux();
		await c.etat.creer(sessionFixe(UUID));
		// contexte sobre : plus de classement (toujours vide), des cartes ; la fiche de position est injectée (◆), seule une carte (◇)
		// s'écarte. Une fiche du dossier de la position, proposée au premier message (périmètre) : on l'écarte.
		const fait = 'projets/alpha/catalogue.md';
		await c.dep.coffre.ecrire(fait, '---\nid: 01ABD\ntype: sujet\nupdated: 2026-11-01\n---\n# Catalogue\n\nAlpha livre le catalogue en mars.\n');
		const client = await connecter(c);
		await jusqua(() => client.recus.length > 0, 2000);
		await appeler(c.service.port, 'POST', ROUTES.hook, { jeton: c.service.jeton, corps: { evenement: 'message', session: UUID, horodatageMs: Date.now(), cwd: join(c.racine, 'alpha'), prompt: 'catalogue Alpha' } });
		expect(await jusqua(() => client.recus.some((m) => m.type === 'servi' && m.entree.cartes.some((x) => x.id === fait)), 2000)).toBe(true);
		const route = ROUTES.ecartes.replace(':id', UUID);
		await appeler(c.service.port, 'POST', route, { jeton: c.service.jeton, corps: { id: fait } });
		expect(await jusqua(() => client.recus.some((m) => m.type === 'ecartes' && m.session === UUID && m.ecartes.length === 1 && m.ecartes[0]!.id === fait), 2000)).toBe(true);
		await appeler(c.service.port, 'DELETE', `${route}?id=${encodeURIComponent(fait)}`, { jeton: c.service.jeton });
		expect(await jusqua(() => client.recus.some((m) => m.type === 'ecartes' && m.session === UUID && m.ecartes.length === 0), 2000)).toBe(true);
	});

	it('vue de session rediffusée quand un écart coupe l’injection automatique, puis quand une réactivation la lève', async () => {
		const c = await serviceFaux();
		await c.etat.creer(sessionFixe(UUID));
		const sens = { ...modeleNonAppris(), apprisLe: '2026-11-25T10:00:00.000Z', refus: [], accepte: true, echelle: echelleDesSignaux(c.dep.reglages().contexte), biais: 3, poids: { cosinusRelatif: 0 } };
		c.dep.note = () => ({ coefficients: { complets: modeleNonAppris(), sens }, installes: { sens: null, reranker: null } });
		const T = Date.parse('2026-11-25T11:00:00.000Z');
		// 17 fiches injectées par Mnemo, 16 déjà écartées : la dix-septième coupera
		for (let i = 0; i < 17; i++) {
			await c.etat.noterGeste({ geste: 'injectee_auto', session: UUID, fiche: `notes/n${i}.md`, empreinte: null, horodatageMs: T + i, note: { niveau: 'sens' } });
			if (i < 16) await c.etat.noterGeste({ geste: 'ecartee_ici', session: UUID, fiche: `notes/n${i}.md`, empreinte: null, horodatageMs: T + 100 + i });
		}
		await c.etat.journaliser({ session: UUID, moment: 'message', horodatageMs: Date.now(), ids: [], texte: '', ms: 1, sens: false, demande: 'Alpha', classement: [{ id: 'notes/n16.md', note: 0.9, servi: true, rang: 1 }], muet: null, cartes: [], position: null });
		const client = await connecter(c);
		await jusqua(() => client.recus.length > 0, 2000);
		const coupee = (m: MessageServeur) => m.type === 'session' && m.session.id === UUID && (m.session.injectionCoupee?.length ?? 0) > 0;
		expect(client.recus.some(coupee)).toBe(false);
		expect((await appeler(c.service.port, 'POST', ROUTES.ecartes.replace(':id', UUID), { jeton: c.service.jeton, corps: { id: 'notes/n16.md' } })).statut).toBe(200);
		expect(await jusqua(() => client.recus.some(coupee), 2000)).toBe(true);
		const vue = client.recus.find(coupee) as Extract<MessageServeur, { type: 'session' }>;
		expect(vue.session.injectionCoupee).toEqual([{ niveau: 'sens', injections: 17, ecartees: 17, depuisMs: expect.any(Number), motif: '17 des 17 dernières fiches injectées par Mnemo ont été écartées' }]);
		const avant = client.recus.length;
		expect((await appeler(c.service.port, 'POST', ROUTES.injectionAutomatique, { jeton: c.service.jeton, corps: { session: UUID } })).statut).toBe(200);
		const levee = (m: MessageServeur) => m.type === 'session' && m.session.id === UUID && m.session.injectionCoupee === undefined;
		expect(await jusqua(() => client.recus.slice(avant).some(levee), 2000)).toBe(true);
	});

	it('vue de session rediffusée au démarrage (coupure déjà là) et après un nouvel apprentissage qui la lève, sans geste', async () => {
		const T = Date.parse('2026-11-25T11:00:00.000Z');
		const sens = (apprisLe: string) => ({ ...modeleNonAppris(), apprisLe, refus: [], accepte: true, echelle: echelleDesSignaux(REGLAGES_PAR_DEFAUT.contexte), biais: 3, poids: { cosinusRelatif: 0 } });
		let apprisLe = '2026-11-25T10:00:00.000Z';
		const c = await serviceFaux(
			{ sondageMs: 100 },
			{
				avant: async (etat, _racine, dep) => {
					await etat.creer(sessionFixe(UUID));
					dep.note = () => ({ coefficients: { complets: modeleNonAppris(), sens: sens(apprisLe) }, installes: { sens: null, reranker: null } });
					for (let i = 0; i < 17; i++) {
						await etat.noterGeste({ geste: 'injectee_auto', session: UUID, fiche: `notes/n${i}.md`, empreinte: null, horodatageMs: T + i, note: { niveau: 'sens' } });
						await etat.noterGeste({ geste: 'ecartee_ici', session: UUID, fiche: `notes/n${i}.md`, empreinte: null, horodatageMs: T + 100 + i });
					}
				},
			},
		);
		const client = await connecter(c);
		const coupee = (m: MessageServeur) => (m.type === 'session' && m.session.id === UUID && (m.session.injectionCoupee?.length ?? 0) > 0) || (m.type === 'sessions' && m.sessions.some((s) => s.id === UUID && (s.injectionCoupee?.length ?? 0) > 0));
		expect(await jusqua(() => client.recus.some(coupee), 2000)).toBe(true);
		const avant = client.recus.length;
		// apprentissage plus récent que les écarts : la coupure tombe, rediffusée sans geste ni message
		apprisLe = '2026-11-25T12:00:00.000Z';
		const levee = (m: MessageServeur) => m.type === 'session' && m.session.id === UUID && m.session.injectionCoupee === undefined;
		expect(await jusqua(() => client.recus.slice(avant).some(levee), 3000)).toBe(true);
		expect(await c.etat.gestes({ sortes: ['injection_reactivee'], limite: null })).toEqual([]);
	});

	it('sondage : une entrée journalisée est diffusée ; la fin d’une session diffuse ses écartés vidés', { timeout: 20_000 }, async () => {
		const c = await serviceFaux({ sondageMs: 100 }, { avant: async (etat) => etat.creer(sessionFixe(UUID)) });
		const client = await connecter(c);
		await jusqua(() => client.recus.length > 0, 2000);
		await new Promise((r) => setTimeout(r, 300));
		const maintenant = Date.now();
		const classement = [{ id: 'projets/alpha/alpha.md', titre: 'Alpha', note: null, servi: true, rang: 1 }];
		await c.etat.appliquer(UUID, 'message', maintenant);
		await c.etat.journaliser({ session: UUID, moment: 'message', horodatageMs: maintenant, ids: ['projets/alpha/alpha.md'], texte: 'Contexte.', ms: 1, sens: false, demande: null, classement, muet: null, cartes: [], position: null });
		expect(await jusqua(() => client.recus.some((m) => m.type === 'servi' && m.entree.horodatageMs === maintenant), 5000)).toBe(true);
		await c.etat.modifier(UUID, { etat: 'terminee' });
		expect(await jusqua(() => client.recus.some((m) => m.type === 'ecartes' && m.session === UUID && m.ecartes.length === 0), 5000)).toBe(true);
	});

	it('`servi` diffusé quand un hook sert un contexte ; `memoire` après une écriture', async () => {
		const c = await serviceFaux();
		await c.etat.creer(sessionFixe(UUID));
		const client = await connecter(c);
		await jusqua(() => client.recus.length > 0, 2000);
		const r = await appeler(c.service.port, 'POST', ROUTES.hook, { jeton: c.service.jeton, corps: { evenement: 'message', prompt: 'alpha', session: UUID, horodatageMs: Date.now(), cwd: join(c.racine, 'alpha') } });
		expect((r.corps as { contexte?: string }).contexte).toMatch(/Alpha/u);
		expect(await jusqua(() => client.recus.some((m) => m.type === 'servi' && m.entree.session === UUID && m.entree.moment === 'message'), 2000)).toBe(true);

		await appeler(c.service.port, 'POST', ROUTES.proposer, {
			jeton: c.service.jeton,
			corps: { genre: 'fait', fiche: 'projets/alpha/alpha.md', texte: 'Alpha livre en mars.', nature: 'declare', source: { ref: 'séance', type: 'utilisateur' } },
		});
		expect(await jusqua(() => client.recus.some((m) => m.type === 'memoire'), 2000)).toBe(true);
	});

	it('`lues` diffusé après un outil qui lit une fiche ; pas rediffusé quand rien n’a changé', async () => {
		const c = await serviceFaux();
		await c.etat.creer(sessionFixe(UUID));
		const client = await connecter(c);
		await jusqua(() => client.recus.length > 0, 2000);
		const apresOutil = (nom: string, entree: Record<string, unknown>, horodatageMs: number) =>
			appeler(c.service.port, 'POST', ROUTES.hook, { jeton: c.service.jeton, corps: { evenement: 'apres_outil', session: UUID, horodatageMs, cwd: join(c.racine, 'alpha'), outil: { nom, entree } } });
		await apresOutil('mcp__mnemo__lire', { id: 'projets/alpha/alpha.md' }, 1000);
		expect(
			await jusqua(() => client.recus.some((m) => m.type === 'lues' && m.session === UUID && m.lues.length === 1 && m.lues[0]!.chemin === 'projets/alpha/alpha.md' && m.lues[0]!.horodatageMs === 1000), 2000),
		).toBe(true);
		// un outil qui ne lit aucune fiche : même liste, pas de nouveau message
		await apresOutil('Read', { file_path: '/a.php' }, 2000);
		await new Promise((r) => setTimeout(r, 300));
		expect(client.recus.filter((m) => m.type === 'lues')).toHaveLength(1);
		// un après-outil que le profil ne demande pas (l'état seul) : ni lecture notée, ni `lues` diffusé
		await appeler(c.service.port, 'POST', ROUTES.hook, {
			jeton: c.service.jeton,
			corps: { evenement: 'apres_outil', session: UUID, horodatageMs: 3000, cwd: join(c.racine, 'alpha'), outil: { nom: 'mcp__mnemo__lire', entree: { id: 'projets/beta/beta.md' } }, sansContexte: true },
		});
		await new Promise((r) => setTimeout(r, 300));
		expect(client.recus.filter((m) => m.type === 'lues')).toHaveLength(1);
		expect(await c.etat.lire(UUID)).toMatchObject({ majMs: 3000 });
	});

	it('client parti (ne répond plus aux pings) : oublié au ping suivant ; un client vivant reste', async () => {
		const c = await serviceFaux({ pingMs: 150 });
		const parti = await connecter(c, { autoPong: false });
		const vivant = await connecter(c);
		const code = await Promise.race([parti.ferme, new Promise<number>((r) => setTimeout(() => r(-1), 5000))]);
		expect(code).toBe(1006);
		await new Promise((r) => setTimeout(r, 400));
		expect(vivant.ws.readyState).toBe(WebSocket.OPEN);
	});
});

const terminaux = await terminauxPty({ delaiArretMs: 300 });
const sauter = !terminaux.disponibles().ok && process.env.CI === undefined;

describe.skipIf(sauter)('WebSocket : client lent (vrai pseudo-terminal, faux-claude --bavard 20)', () => {
	it('client qui ne lit plus → fermé en 4008, le terminal n’est pas freiné, mémoire bornée ; reconnexion → relecture', async () => {
		const c = await serviceFaux(
			{},
			{
				pil: (pil) => {
					pil.terminaux = terminaux;
					commandeClaude(pil, { commande: process.execPath, avant: [FAUX_CLAUDE, '--bavard', '20'] });
				},
			},
		);
		const lent = await connecter(c, { sansSorties: true });
		const rapide = await connecter(c, { sansSorties: true });
		const avant = process.memoryUsage().rss;
		const vue = await lancer(c);
		const etat = await c.etat.lire(vue.id);
		if (etat?.pid) pids.add(etat.pid);
		lent.envoyer({ type: 'abonner', session: vue.id });
		await jusqua(() => lent.recus.some((m) => m.type === 'relecture'), 5000);
		// le client lent cesse de lire : plus rien n'est pris sur sa socket
		lent.ws.pause();
		rapide.envoyer({ type: 'abonner', session: vue.id });

		// le faux claude écrit ses 20 Mo sans attendre le client lent ; la mémoire du service reste bornée
		let max = 0;
		const mesurer = () => {
			max = Math.max(max, process.memoryUsage().rss - avant);
		};
		// 15 Mo passés : bien au-delà des tampons du système et du retard permis, le client lent a été fermé
		expect(await jusqua(() => (mesurer(), rapide.recuSortie > 15 * 1024 * 1024), 120_000), `${rapide.recuSortie} octets reçus, fin : ${JSON.stringify(rapide.queue.slice(-3000))}`).toBe(true);
		// il relit ce qui l'attendait, puis la fermeture 4008
		lent.ws.resume();
		const code = await Promise.race([lent.ferme, new Promise<number>((r) => setTimeout(() => r(-1), 30_000))]);
		expect(code).toBe(CODE_FERMETURE_LENT);
		expect(await jusqua(() => (mesurer(), /prêt/u.test(rapide.queue)), 120_000)).toBe(true);
		expect(max).toBeLessThan(100 * 1024 * 1024);

		// reconnexion : l'écran revient par la relecture du tampon
		const retour = await connecter(c);
		retour.envoyer({ type: 'abonner', session: vue.id });
		expect(await jusqua(() => retour.recus.some((m) => m.type === 'relecture' && /prêt/u.test(m.donnees)), 5000)).toBe(true);
	}, 180_000);
});
