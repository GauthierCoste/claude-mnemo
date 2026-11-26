import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { ROUTES } from '@mnemo/contrat';
import type { MessageServeur, ReponseMessageAJuger, VueEntrainement } from '@mnemo/contrat';
import { apprendreNote } from '../../src/application/apprendre-note.ts';
import type { CasContexte } from '../../src/application/banc-contexte.ts';
import type { BilanExtraction } from '../../src/application/banc-extraire.ts';
import type { GesteNote } from '../../src/application/ports.ts';
import type { RemplacementsEntrainement } from '../../src/adaptateurs/http/entrainement.ts';
import { appeler, jusqua, serviceFaux } from '../aides/service-faux.ts';
import type { ContexteService } from '../aides/service-faux.ts';

const clients: WebSocket[] = [];
afterEach(() => {
	while (clients.length > 0) clients.pop()!.terminate();
});

const unCas = (nom: string, chemins: string[], extra: Partial<CasContexte> = {}): CasContexte => ({
	nom,
	position: 'p',
	message: `message ${nom} sur le budget annuel du projet alpha et ses échéances principales`,
	premier: false,
	attendues: [],
	interdites: [],
	silence: false,
	session: `s-${nom}`,
	rang: 1,
	candidates: chemins.map((chemin) => ({ chemin, titre: chemin, ligne: '', listes: ['sens'], signaux: {} })),
	jugements: {},
	...extra,
});

function api(c: ContexteService) {
	const { port, jeton } = c.service;
	return {
		get: (route: string) => appeler(port, 'GET', route, { jeton }),
		post: (route: string, corps?: unknown) => appeler(port, 'POST', route, { jeton, corps: corps ?? {} }),
	};
}

const fichierBanc = (racine: string) => join(racine, '.mnemo', 'banc-contexte.json');
async function avecBanc(cas: CasContexte[], remplacements: RemplacementsEntrainement = {}): Promise<ContexteService> {
	const c = await serviceFaux({}, { entrainement: remplacements });
	await mkdir(join(c.racine, '.mnemo'), { recursive: true });
	await writeFile(fichierBanc(c.racine), JSON.stringify(cas));
	return c;
}
const lireBanc = (racine: string): CasContexte[] => JSON.parse(readFileSync(fichierBanc(racine), 'utf8')) as CasContexte[];

/** Une extraction tenue en main (aucun modèle) : le test la libère. */
function extractionEnMain() {
	let liberer!: (b: BilanExtraction) => void;
	const promesse = new Promise<BilanExtraction>((r) => (liberer = r));
	const remplacements: RemplacementsEntrainement = {
		journal: async () => [{ session: 'j', groupe: '', rang: 1, horodatageMs: 1, message: 'nouveau message', position: 'p', precedent: null }],
		extraire: (_m, o) => Promise.race([promesse, new Promise<never>((_r, rejeter) => o.signal.addEventListener('abort', () => rejeter(Object.assign(new Error('arrêté'), { name: 'AbortError' }))))]),
	};
	return { remplacements, liberer: () => liberer({ cas: [unCas('nouveau', ['x.md'])], sansCandidate: 0, sansModele: 0, modeles: { sens: true, reranker: true } }) };
}

describe('routes de l’entraînement de la note', () => {
	it('GET : l’état (banc, note de départ par niveau, juge absent faute de Claude Code, aucune tâche)', async () => {
		const c = await avecBanc([unCas('m', ['a.md']), unCas('v', ['b.md'], { jugements: { 'b.md': 'pertinente' }, valideLe: '2026-11-25T10:00:00.000Z' })]);
		const r = await api(c).get(ROUTES.entrainement);
		expect(r.statut).toBe(200);
		const etat = r.corps as VueEntrainement;
		expect(etat.banc).toMatchObject({ messages: 2, valides: 1, aJuger: 1, paires: 1, aPrejuger: 1 });
		expect(etat.note.niveaux.map((n) => n.niveau)).toEqual(['complets', 'sens']);
		expect(etat.note.avant).toBe(false);
		expect(etat.juge.disponible).toBe(false);
		expect(etat.juge.raison).toMatch(/Claude Code introuvable/u);
		expect(etat.tache).toBeNull();
		expect(etat.historique).toEqual([]);
	});

	it('Claude Code est cherché une fois pour plusieurs lectures de l’état (gardé 30 s), et de nouveau avant de pré-juger', async () => {
		let recherches = 0;
		const c = await avecBanc([unCas('m', ['a.md'])], {
			trouverClaude: () => {
				recherches++;
				return null;
			},
		});
		for (let i = 0; i < 5; i++) expect((await api(c).get(ROUTES.entrainement)).statut).toBe(200);
		expect(recherches).toBe(1);
		expect((await api(c).post(ROUTES.entrainementPrejuger)).statut).toBe(409);
		expect(recherches).toBe(2);
	});

	it('corps invalides : 400', async () => {
		const c = await avecBanc([unCas('m', ['a.md'])]);
		for (const corps of [{ nombre: 0 }, { nombre: 201 }, { nombre: 'dix' }, { nombre: 1.5 }, { autre: 1 }, []]) expect((await api(c).post(ROUTES.entrainementPreparer, corps)).statut).toBe(400);
		expect((await api(c).post(ROUTES.entrainementPrejuger, { nombre: 3 })).statut).toBe(400);
		expect((await api(c).post(ROUTES.entrainementApprendre, { origine: 'automatique' })).statut).toBe(400);
		for (const corps of [
			{},
			{ indice: -1, jugements: {}, resteNonUtile: true },
			{ indice: 0, jugements: { 'a.md': 'oui' }, resteNonUtile: true },
			{ indice: 0, jugements: {}, resteNonUtile: 'oui' },
			{ indice: 0, jugements: {}, resteNonUtile: true, silence: true, passer: true },
			{ indice: 0, jugements: {}, resteNonUtile: true, autre: 1 },
		]) {
			const r = await api(c).post(ROUTES.entrainementMessage, corps);
			expect(r.statut).toBe(400);
			expect(r.corps).toMatchObject({ erreur: expect.any(String) });
		}
		expect((await api(c).get(`${ROUTES.entrainementMessage}?indice=deux`)).statut).toBe(400);
		expect(lireBanc(c.racine)[0]!.valideLe).toBeUndefined();
	});

	it('pré-juger sans Claude Code, apprendre sans jugement validé, revenir sans modèle d’avant, annuler sans réponse, arrêter sans tâche : 409', async () => {
		const c = await avecBanc([unCas('m', ['a.md'])]);
		for (const route of [ROUTES.entrainementPrejuger, ROUTES.entrainementApprendre, ROUTES.entrainementRevenir, ROUTES.entrainementAnnuler, ROUTES.entrainementArreter]) {
			const r = await api(c).post(route);
			expect(r.statut, route).toBe(409);
		}
		expect(((await api(c).get(ROUTES.entrainement)).corps as VueEntrainement).tache).toBeNull();
	});

	it('préparer : 202 et la tâche ; une autre tâche pendant ce temps : 409 ; juger reste permis ; arrêter : 200, la tâche finit ; diffusion WebSocket', async () => {
		const { remplacements, liberer } = extractionEnMain();
		const c = await avecBanc([unCas('m', ['a.md', 'b.md'])], remplacements);
		const recus: MessageServeur[] = [];
		await new Promise<void>((resoudre, rejeter) => {
			const ws = new WebSocket(`ws://127.0.0.1:${c.service.port}${ROUTES.ws}?jeton=${c.service.jeton}`);
			clients.push(ws);
			ws.on('message', (brut) => recus.push(JSON.parse(String(brut)) as MessageServeur));
			ws.once('open', () => resoudre());
			ws.once('error', rejeter);
		});
		const r = await api(c).post(ROUTES.entrainementPreparer, { nombre: 5 });
		expect(r.statut).toBe(202);
		expect((r.corps as VueEntrainement).tache).toMatchObject({ genre: 'preparer' });
		// le verrou du banc est tenu au nom du service
		expect(JSON.parse(readFileSync(`${fichierBanc(c.racine)}.verrou`, 'utf8'))).toMatchObject({ pid: process.pid, operation: 'préparer des messages', service: true });
		const occupe = await api(c).post(ROUTES.entrainementApprendre);
		expect(occupe.statut).toBe(409);
		expect(occupe.corps).toMatchObject({ erreur: expect.stringMatching(/préparer des messages/u) });
		expect((await api(c).post(ROUTES.entrainementPreparer)).statut).toBe(409);
		const reponse = await api(c).post(ROUTES.entrainementMessage, { indice: 0, jugements: { 'a.md': 'pertinente' }, resteNonUtile: true });
		expect(reponse.statut).toBe(200);
		expect(reponse.corps).toEqual({ suivant: null });
		expect(await jusqua(() => recus.some((m) => m.type === 'entrainement' && m.etat.tache?.genre === 'preparer'), 2000)).toBe(true);
		liberer();
		expect(await jusqua(async () => ((await api(c).get(ROUTES.entrainement)).corps as VueEntrainement).tache === null, 2000)).toBe(true);
		expect(lireBanc(c.racine).map((x) => x.nom)).toEqual(['m', 'nouveau']);
		expect(lireBanc(c.racine)[0]!.jugements).toEqual({ 'a.md': 'pertinente', 'b.md': 'non_pertinente' });
		expect(existsSync(`${fichierBanc(c.racine)}.verrou`)).toBe(false);
		expect(await jusqua(() => recus.some((m) => m.type === 'entrainement' && m.etat.tache === null && m.etat.banc.messages === 2), 2000)).toBe(true);

		const autre = extractionEnMain();
		const c2 = await avecBanc([], autre.remplacements);
		expect((await api(c2).post(ROUTES.entrainementPreparer)).statut).toBe(202);
		const arret = await api(c2).post(ROUTES.entrainementArreter);
		expect(arret.statut).toBe(200);
		expect(await jusqua(async () => ((await api(c2).get(ROUTES.entrainement)).corps as VueEntrainement).tache === null, 2000)).toBe(true);
		expect(((await api(c2).get(ROUTES.entrainement)).corps as VueEntrainement).derniereErreur).toBeUndefined();
	});

	it('le message à juger, la réponse, l’annulation, accepter les sûres ; indice inconnu : 404 ; silence refusé : 409', async () => {
		const sure = { jugement: 'non_pertinente' as const, confiance: 0.97, raison: 'hors sujet' };
		const c = await avecBanc([unCas('m1', ['a.md', 'b.md']), unCas('m2', ['c.md'], { prejugements: { 'c.md': sure } })]);
		const lu = (await api(c).get(ROUTES.entrainementMessage)).corps as ReponseMessageAJuger;
		// celui qui attend une relecture d'abord
		expect(lu.message).toMatchObject({ indice: 1, aRelire: true, restants: 2 });
		expect(lu.message!.candidates).toEqual([{ chemin: 'c.md', titre: 'c.md', ligne: '', synthese: '', proposition: sure, jugement: null }]);
		expect((await api(c).get(`${ROUTES.entrainementMessage}?indice=0`)).corps).toMatchObject({ message: { indice: 0 } });
		expect((await api(c).get(`${ROUTES.entrainementMessage}?indice=9`)).statut).toBe(404);
		expect((await api(c).post(ROUTES.entrainementMessage, { indice: 9, jugements: {}, resteNonUtile: true })).statut).toBe(404);
		expect((await api(c).post(ROUTES.entrainementMessage, { indice: 0, jugements: { 'a.md': 'pertinente' }, resteNonUtile: true, silence: true })).statut).toBe(409);
		expect((await api(c).post(ROUTES.entrainementMessage, { indice: 0, jugements: { 'a.md': 'pertinente' }, resteNonUtile: false })).corps).toEqual({ suivant: 1 });
		expect(lireBanc(c.racine)[0]).toMatchObject({ jugements: { 'a.md': 'pertinente' }, valideLe: expect.any(String) });
		expect((await api(c).post(ROUTES.entrainementAccepterSures)).corps).toEqual({ acceptes: 1 });
		expect(lireBanc(c.racine)[1]).toMatchObject({ jugements: { 'c.md': 'non_pertinente' } });
		expect((await api(c).post(ROUTES.entrainementAnnuler)).corps).toEqual({ indice: 1 });
		expect((await api(c).post(ROUTES.entrainementAnnuler)).corps).toEqual({ indice: 0 });
		expect(lireBanc(c.racine).map((x) => x.valideLe)).toEqual([undefined, undefined]);
		expect((await api(c).get(ROUTES.entrainementMessage)).corps).toMatchObject({ message: { indice: 1 } });
	});

	it('une commande « mnemo banc contexte --juger » tient le fichier : la réponse est refusée (409) en la nommant', async () => {
		const c = await avecBanc([unCas('m', ['a.md'])]);
		// un processus vivant (le parent de ce test) joue la commande
		writeFileSync(`${fichierBanc(c.racine)}.verrou`, JSON.stringify({ pid: process.ppid, operation: '--juger', depuis: 'x' }));
		const r = await api(c).post(ROUTES.entrainementMessage, { indice: 0, jugements: {}, resteNonUtile: true });
		expect(r.statut).toBe(409);
		expect(r.corps).toMatchObject({ erreur: expect.stringMatching(/mnemo banc contexte --juger/u) });
		expect((await api(c).post(ROUTES.entrainementPreparer)).statut).toBe(409);
		expect(lireBanc(c.racine)[0]!.valideLe).toBeUndefined();
	});

	it('apprendre (dans le processus) : 202, puis le nouveau modèle écrit, le modèle d’avant gardé, une ligne d’historique ; revenir les échange (deux fois : retour au modèle appris)', async () => {
		const c = await avecBanc([unCas('v', ['a.md'], { jugements: { 'a.md': 'pertinente' }, valideLe: '2026-11-25T10:00:00.000Z' })], {
			// l'apprentissage réel, dans le processus (le fil a son propre essai)
			apprenti: { apprendre: async (jeu, o) => apprendreNote(jeu, { ...o, graines: [1] }) },
		});
		const r = await api(c).post(ROUTES.entrainementApprendre);
		expect(r.statut).toBe(202);
		expect(await jusqua(async () => ((await api(c).get(ROUTES.entrainement)).corps as VueEntrainement).historique.length === 1, 5000)).toBe(true);
		const etat = (await api(c).get(ROUTES.entrainement)).corps as VueEntrainement;
		expect(etat.historique[0]).toMatchObject({ origine: 'manuel', remplace: true });
		expect(etat.note.avant).toBe(true);
		expect(etat.derniereErreur).toBeUndefined();
		const courant = join(c.racine, '.mnemo', 'coefficients-note.json');
		const avant = join(c.racine, '.mnemo', 'coefficients-note.avant.json');
		expect(existsSync(courant)).toBe(true);
		// avant, aucun fichier : le module livré valait
		expect(JSON.parse(readFileSync(avant, 'utf8'))).toEqual({ aucun: true });
		expect(existsSync(join(c.racine, '.mnemo', 'apprentissage-note.txt'))).toBe(true);
		expect((await api(c).post(ROUTES.entrainementRevenir)).statut).toBe(200);
		expect(existsSync(courant)).toBe(false);
		expect(existsSync(avant)).toBe(true);
		// un échange : revenir encore rend le modèle appris
		expect((await api(c).post(ROUTES.entrainementRevenir)).statut).toBe(200);
		expect(existsSync(courant)).toBe(true);
		expect(JSON.parse(readFileSync(avant, 'utf8'))).toEqual({ aucun: true });
	});
	it('préparer avec les modèles du service : le niveau de la machine est respecté (Sens seul : le reranker n’est jamais appelé)', async () => {
		const journal: RemplacementsEntrainement['journal'] = async () => [{ session: 'j', groupe: '', rang: 1, horodatageMs: 1, message: 'le budget du projet alpha pour la prochaine année', position: '', precedent: null }];
		const appels: Record<string, number> = {};
		for (const niveau of ['sens', 'complets'] as const) {
			const c = await avecBanc([], { journal });
			c.modeles.vue = { ...c.modeles.vue, niveau };
			appels[niveau] = 0;
			c.dep.reranker = {
				noter: async () => {
					appels[niveau]!++;
					return null;
				},
			};
			expect((await api(c).post(ROUTES.entrainementPreparer, { nombre: 1 })).statut).toBe(202);
			expect(await jusqua(async () => ((await api(c).get(ROUTES.entrainement)).corps as VueEntrainement).tache === null, 5000)).toBe(true);
		}
		expect(appels['sens']).toBe(0);
		expect(appels['complets']).toBeGreaterThan(0);
	});
});

describe('réapprentissage en fond dans le service', () => {
	/** 20 ✗ d'une session (de quoi réapprendre), notés avec leur rang et leurs signaux. */
	const gestes: GesteNote[] = Array.from({ length: 20 }, (_, i) => ({
		rang: i + 1,
		horodatageMs: 1_000 + i,
		geste: 'ecartee_ici',
		origine: 'utilisateur',
		session: 'S',
		dossier: '',
		position: null,
		fiche: `f${i}.md`,
		empreinte: null,
		message: null,
		rangMessage: 1,
		note: { rang: 2, signaux: { cosinusRelatif: 0.1, bm25Relatif: null } },
		vecteur: null,
		modeleVecteur: null,
	}));
	const banc = [unCas('v', ['a.md'], { jugements: { 'a.md': 'pertinente' }, valideLe: '2026-11-25T10:00:00.000Z' })];

	async function service(reglage: boolean) {
		const implicites: unknown[] = [];
		const c = await serviceFaux(
			{ reapprentissage: { premiereMs: 10, intervalleMs: 60_000 } },
			{
				pil: (p) => {
					p.etat.gestes = async () => gestes;
				},
				avant: async (_etat, racine, dep) => {
					await writeFile(fichierBanc(racine), JSON.stringify(banc));
					const reglages = dep.reglages();
					dep.reglages = () => ({ ...reglages, entrainement: { automatique: reglage } });
				},
				entrainement: {
					apprenti: {
						apprendre: async (jeu, o) => {
							implicites.push(o.implicites);
							return apprendreNote(jeu, { ...o, graines: [1] });
						},
					},
				},
			},
		);
		return { c, implicites };
	}

	it('peu après le démarrage, conditions réunies : un essai automatique avec les paires des gestes, une ligne d’historique', async () => {
		const { c, implicites } = await service(true);
		expect(await jusqua(async () => ((await api(c).get(ROUTES.entrainement)).corps as VueEntrainement).historique.length === 1, 5000)).toBe(true);
		const etat = (await api(c).get(ROUTES.entrainement)).corps as VueEntrainement;
		expect(etat.historique[0]!.origine).toBe('automatique');
		expect(etat.historique[0]!.erreur).toBeUndefined();
		expect((implicites[0] as unknown[]).length).toBe(20);
		expect(c.journal.some((m) => m.includes('réapprentissage en fond sur les gestes lancé'))).toBe(true);
	});

	it('réglage coupé : aucun essai', async () => {
		const { c, implicites } = await service(false);
		await new Promise((r) => setTimeout(r, 200));
		expect(((await api(c).get(ROUTES.entrainement)).corps as VueEntrainement).historique).toEqual([]);
		expect(implicites).toEqual([]);
	});
});
