/**
 * Bout en bout : l'interface construite et ses modules client (`src/client/`, sans DOM), pilotés depuis Node avec `fetch`
 * et `WebSocket`, contre le vrai service lancé par la CLI (faux `claude`, `HOME` temporaire, aucun modèle, aucun navigateur).
 * Les étapes se suivent et partagent le même service (et le même dossier Mnemo).
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	ROUTES,
	type DonneesGraphe,
	type FicheVue,
	type MessageServeur,
	type ReglagesVue,
	type ReponseLancement,
	type ReponseRecherche,
	type ResultatEcriture,
	type SanteVue,
	type SessionVue,
	type EtatModelesVue,
} from '@mnemo/contrat';
import { ErreurApi } from '../../src/client/api.ts';
import type { EtatConnexion, FluxTerminal } from '../../src/client/connexion.ts';
import type { Client } from '../../src/client/contexte.tsx';
import { creerClientReel } from '../../src/client/creer-client.ts';
import { commandeMnemo, construireInterface, lancerService, tuerLesRestes, type ServiceLance } from './lancer-service.ts';

const DELAI = 60_000;

/** Attend qu'une condition soit vraie (sondée toutes les 20 ms) ; faux après `delaiMs`. */
async function jusqua(condition: () => boolean | Promise<boolean>, delaiMs = 30_000): Promise<boolean> {
	const fin = Date.now() + delaiMs;
	while (Date.now() < fin) {
		if (await condition()) return true;
		await new Promise((r) => setTimeout(r, 20));
	}
	return condition();
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

type ClientTest = {
	client: Client;
	messages: MessageServeur[];
	etats: EtatConnexion[];
	/** WebSocket créés par la connexion (chaque tentative en crée un). */
	sockets(): number;
	/** Clés effacées du stockage (le jeton refusé). */
	effaces: string[];
};

/**
 * Le client réel de l'interface, tel que `main.tsx` le crée, vers le service de `port` : `fetch` de Node avec l'origine du
 * service (le navigateur résout l'adresse relative et pose `Origin`), `WebSocket` de Node, délais de reconnexion raccourcis.
 */
function clientVers(port: number, jeton: string): ClientTest {
	const origine = `http://127.0.0.1:${port}`;
	const fetchNavigateur: typeof fetch = (entree, init) => {
		const entetes = new Headers(init?.headers);
		entetes.set('Origin', origine);
		return fetch(new URL(entree instanceof Request ? entree.url : String(entree), origine), { ...init, headers: entetes });
	};
	let sockets = 0;
	class WebSocketCompte extends WebSocket {
		constructor(url: string | URL, protocoles?: string | string[]) {
			super(url, protocoles);
			sockets++;
		}
	}
	const effaces: string[] = [];
	const client = creerClientReel({
		jeton,
		origine,
		fetch: fetchNavigateur,
		WebSocket: WebSocketCompte,
		stockage: { removeItem: (cle: string) => void effaces.push(cle) },
		minuterie: { poser: (f, ms) => setTimeout(f, Math.min(ms, 200)), annuler: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) },
	});
	const messages: MessageServeur[] = [];
	const etats: EtatConnexion[] = [];
	client.connexion.surMessage((m) => void messages.push(m));
	client.connexion.surEtat((e) => void etats.push(e));
	return { client, messages, etats, sockets: () => sockets, effaces };
}

const avecId = (route: string, id: string) => route.replace(':id', id);

function fichiers(dossier: string): string[] {
	return readdirSync(dossier).flatMap((n) => {
		const c = join(dossier, n);
		return statSync(c).isDirectory() ? fichiers(c) : [c];
	});
}

let dist = '';
let dossier = '';
let service: ServiceLance | null = null;
let port = 0;
let jeton = '';
let terminaux = false;
const clients: ClientTest[] = [];
let principal: ClientTest;
let session: SessionVue;
let flux = '';
let relectures = 0;

beforeAll(async () => {
	dist = await construireInterface();
	dossier = realpathSync(mkdtempSync(join(tmpdir(), 'mnemo-ui-bout-')));
	service = await lancerService({ dossier, dist });
	({ port, jeton } = service);
	mkdirSync(join(dossier, 'alpha'));
	// la mémoire neuve n'a plus de dossiers imposés : la fiche que la recherche et l'édition brute visent est déposée ici
	mkdirSync(join(dossier, '_mnemo', 'clients'), { recursive: true });
	writeFileSync(join(dossier, '_mnemo', 'clients', 'clients.md'), '---\nid: 01CLIENTSBOUTENBOUT00000000\ntype: dossier\nupdated: 2026-11-01\n---\n# Clients\n\nLes clients et leurs projets chez eux.\n');
	const sante = (await (await fetch(`http://127.0.0.1:${port}${ROUTES.sante}`, { headers: { Authorization: `Bearer ${jeton}` } })).json()) as SanteVue;
	// sans node-pty, les sessions sont « à coller » : sauté en local, exigé en CI
	terminaux = sante.terminaux.ok;
	if (!terminaux && process.env['CI'] !== undefined) throw new Error('node-pty absent en CI.');
	principal = clientVers(port, jeton);
	clients.push(principal);
}, 180_000);

afterAll(async () => {
	for (const c of clients) c.client.connexion.fermer();
	await service?.arreter();
	if (dossier) tuerLesRestes(dossier);
	rmSync(dossier, { recursive: true, force: true });
	rmSync(dist, { recursive: true, force: true });
}, 60_000);

describe('interface de bout en bout, contre le vrai service', () => {
	it('sert index.html avec sa CSP, et chacun des fichiers de assets/', async () => {
		const reponse = await fetch(`http://127.0.0.1:${port}/`);
		expect(reponse.status).toBe(200);
		expect(reponse.headers.get('content-type')).toMatch(/^text\/html/u);
		const csp = reponse.headers.get('content-security-policy') ?? '';
		expect(csp).toContain("script-src 'self'");
		expect(csp).toContain("default-src 'self'");
		expect(csp).not.toMatch(/https?:\/\/(?!127\.0\.0\.1|localhost)/u);
		const html = await reponse.text();
		expect(html).toBe(readFileSync(join(dist, 'index.html'), 'utf8'));
		const references = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/gu)].map((m) => m[1]!);
		expect(references.some((r) => r.endsWith('.js'))).toBe(true);
		// ceux qu'index.html référence, et ceux chargés plus tard (le morceau du graphe) : tous servis tels quels
		const tous = new Set([...references, ...fichiers(join(dist, 'assets')).map((f) => relative(dist, f).split('\\').join('/'))]);
		for (const chemin of tous) {
			const r = await fetch(`http://127.0.0.1:${port}/${chemin}`);
			expect(r.status, chemin).toBe(200);
			expect(Buffer.from(await r.arrayBuffer()).equals(readFileSync(join(dist, chemin))), chemin).toBe(true);
		}
	});

	it('dist/ ne charge rien d’ailleurs : aucune URL http(s) hors licences, espaces de noms XML et lien d’erreur de React', () => {
		// Permis : des identifiants, jamais chargés (la CSP l'interdirait de toute façon) — espaces de noms SVG/MathML/XHTML,
		// et le lien de documentation que React met dans ses messages d'erreur.
		const permis = [/^http:\/\/www\.w3\.org\//u, /^https:\/\/react\.dev\/errors\//u];
		const trouvees: string[] = [];
		for (const f of fichiers(dist)) {
			if (!/\.(?:html|js|css|json|webmanifest|svg)$/u.test(f)) continue;
			// commentaires de licence (`/*! … */`, `/** @license … */`, `//! …`) retirés
			const texte = readFileSync(f, 'utf8')
				.replace(/\/\*[!*][\s\S]*?\*\//gu, '')
				.replace(/\/\/![^\n]*/gu, '');
			for (const m of texte.matchAll(/https?:\/\/[^\s"'`)<>\\]+/gu)) if (!permis.some((p) => p.test(m[0]))) trouvees.push(`${relative(dist, f)} : ${m[0]}`);
		}
		expect(trouvees).toEqual([]);
	});

	it('API sans jeton : 401 (sessions, réglages, traitement des sources)', async () => {
		const base = `http://127.0.0.1:${port}`;
		expect((await fetch(`${base}${ROUTES.sessions}`)).status).toBe(401);
		expect((await fetch(`${base}${ROUTES.reglages}`)).status).toBe(401);
		expect((await fetch(`${base}${ROUTES.reglages}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"valeurs":{}}' })).status).toBe(401);
		const traiter = await fetch(`${base}${ROUTES.sourcesTraiter}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"chemins":["sources/x.md"]}' });
		expect(traiter.status).toBe(401);
		// un mauvais jeton aussi, et rien n'est confié à l'archiviste
		const faux = await fetch(`${base}${ROUTES.sourcesTraiter}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${'0'.repeat(64)}` },
			body: '{"chemins":["sources/x.md"]}',
		});
		expect(faux.status).toBe(401);
	});

	it('réglages : lus et modifiés avec le jeton et l’origine du service ; une autre origine est refusée', async () => {
		const { api } = principal.client;
		const avant = await api.lire<ReglagesVue>(ROUTES.reglages);
		const champ = avant.champs.find((c) => c.genre === 'entier' && c.effet === 'immediat' && c.fixePar === undefined);
		expect(champ, 'un réglage entier à effet immédiat').toBeDefined();
		const nouvelle = (champ!.valeur as number) === (champ!.min ?? 0) ? (champ!.min ?? 0) + 1 : (champ!.min ?? 0);
		const apres = await api.remplacer<ReglagesVue>(ROUTES.reglages, { valeurs: { [champ!.cle]: nouvelle } });
		expect(apres.champs.find((c) => c.cle === champ!.cle)?.valeur).toBe(nouvelle);
		expect((await api.lire<ReglagesVue>(ROUTES.reglages)).champs.find((c) => c.cle === champ!.cle)?.valeur).toBe(nouvelle);

		const etrangere = await fetch(`http://127.0.0.1:${port}${ROUTES.reglages}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}`, Origin: 'http://127.0.0.1:1' },
			body: JSON.stringify({ valeurs: { [champ!.cle]: null } }),
		});
		expect(etrangere.status).toBe(403);
		expect((await api.lire<ReglagesVue>(ROUTES.reglages)).champs.find((c) => c.cle === champ!.cle)?.valeur).toBe(nouvelle);

		const retabli = await api.remplacer<ReglagesVue>(ROUTES.reglages, { valeurs: { [champ!.cle]: null } });
		expect(retabli.champs.find((c) => c.cle === champ!.cle)?.valeur).toBe(champ!.defaut);
	});

	it('recherche par les mots (rapide=1), puis complète, sans démarrer de modèle', async () => {
		const { api } = principal.client;
		const rapide = await api.lire<ReponseRecherche>(ROUTES.recherche, { q: 'clients', rapide: '1' }, { remplacement: 'palette' });
		expect(rapide.trouves.some((t) => t.chemin === 'clients/clients.md')).toBe(true);
		expect(rapide.trouves.every((t) => t.note === null)).toBe(true);
		const complete = await api.lire<ReponseRecherche>(ROUTES.recherche, { q: 'clients' }, { remplacement: 'palette' });
		expect(complete.trouves.some((t) => t.chemin === 'clients/clients.md')).toBe(true);
		// aucun modèle installé : rien n'a été lancé, et aucune note
		expect(complete.trouves.every((t) => t.note === null)).toBe(true);
		expect(await api.lire<EtatModelesVue>(ROUTES.modeles)).toEqual({ reranker: 'absent' });
	});

	it('session travail : lancée, relue, écho du faux claude, taille, pause', async (ctx) => {
		if (!terminaux) ctx.skip();
		const { api, connexion } = principal.client;
		expect(await jusqua(() => connexion.etat() === 'ouverte')).toBe(true);

		const lancee = await api.envoyer<ReponseLancement>(ROUTES.sessions, { profil: 'travail', dossier: 'alpha' });
		expect(lancee.manuel).toBeUndefined();
		session = lancee.session;
		expect(await jusqua(() => principal.messages.some((m) => m.type === 'session' && m.session.id === session.id))).toBe(true);

		const ecouter = (m: FluxTerminal) => {
			if (m.type === 'relecture') {
				relectures++;
				flux = m.donnees;
			} else if (m.type === 'sortie') flux += m.donnees;
		};
		connexion.abonner(session.id, ecouter);
		expect(await jusqua(() => relectures > 0)).toBe(true);
		expect(await jusqua(() => flux.includes('prêt')), flux).toBe(true);

		expect(connexion.envoyer({ type: 'entree', session: session.id, donnees: 'bonjour\r' })).toBe(true);
		expect(await jusqua(() => flux.includes('écho: bonjour')), flux).toBe(true);

		expect(connexion.envoyer({ type: 'taille', session: session.id, colonnes: 100, lignes: 30 })).toBe(true);
		expect(await jusqua(() => flux.includes('taille 100x30')), flux).toBe(true);

		const enPause = await api.envoyer<{ session: SessionVue }>(avecId(ROUTES.pause, session.id), {});
		expect(enPause.session.etat).toBe('en_pause');
		expect(await jusqua(() => principal.messages.some((m) => m.type === 'session' && m.session.id === session.id && m.session.etat === 'en_pause'))).toBe(true);

		// reprise : la session retrouve un terminal, auquel on se réabonne (l'abonnement vivait avec l'ancien)
		await api.envoyer(avecId(ROUTES.reprise, session.id), {});
		expect(
			await jusqua(() => principal.messages.some((m) => m.type === 'session' && m.session.id === session.id && m.session.terminal && m.session.etat !== 'en_pause')),
		).toBe(true);
	}, DELAI);

	it('graphe, édition brute (message memoire, graphe à jour), conflit 409 avec l’ancienne empreinte', async () => {
		const { api } = principal.client;
		const graphe = await api.lire<DonneesGraphe>(ROUTES.graphe);
		const avant = graphe.fiches.find((f) => f.chemin === 'clients/clients.md');
		expect(avant?.titre).toBe('Clients');
		const fiche = await api.lire<FicheVue>(ROUTES.fiche, { chemin: 'clients/clients.md' });
		const memoiresAvant = principal.messages.filter((m) => m.type === 'memoire').length;

		const texte = fiche.brut.replace('# Clients', '# Clients et partenaires');
		expect(texte).not.toBe(fiche.brut);
		const r = await api.envoyer<ResultatEcriture>(ROUTES.brut, { chemin: fiche.chemin, texte, empreinte: fiche.empreinte });
		expect(r.statut).toBe('ecrit');

		expect(await jusqua(() => principal.messages.filter((m) => m.type === 'memoire').length > memoiresAvant)).toBe(true);
		let relu: DonneesGraphe | null = null;
		expect(
			await jusqua(async () => {
				relu = await api.lire<DonneesGraphe>(ROUTES.graphe);
				return relu.fiches.find((f) => f.chemin === 'clients/clients.md')?.titre === 'Clients et partenaires';
			}),
		).toBe(true);
		expect(relu!.modifieeMs).toBeGreaterThan(graphe.modifieeMs);

		const conflit = await api.envoyer(ROUTES.brut, { chemin: fiche.chemin, texte: `${fiche.brut}\nAutre.\n`, empreinte: fiche.empreinte }).catch((e: unknown) => e);
		expect(conflit).toBeInstanceOf(ErreurApi);
		expect((conflit as ErreurApi).statut).toBe(409);
		expect((await api.lire<FicheVue>(ROUTES.fiche, { chemin: 'clients/clients.md' })).brut).toBe(texte);
	}, DELAI);

	it('redémarrage (SIGTERM puis relance) : reconnexion avec le même jeton, sessions relues, réabonnement et relecture', async (ctx) => {
		if (!terminaux) ctx.skip();
		const { api, connexion } = principal.client;
		// un abonnement neuf au terminal de la session reprise
		let relu = '';
		let relecturesApres = 0;
		connexion.abonner(session.id, (m) => {
			if (m.type === 'relecture') {
				relecturesApres++;
				relu = m.donnees;
			} else if (m.type === 'sortie') relu += m.donnees;
		});
		expect(await jusqua(() => relecturesApres > 0)).toBe(true);
		expect(await jusqua(() => relu.includes('prêt')), relu).toBe(true);

		await service!.arreter('SIGTERM');
		expect(await jusqua(() => connexion.etat() === 'reconnexion')).toBe(true);
		const relecturesAvant = relecturesApres;
		relu = '';
		service = await lancerService({ dossier, dist, port });
		expect(service.port).toBe(port);
		expect(service.jeton).toBe(jeton);

		expect(await jusqua(() => connexion.etat() === 'ouverte')).toBe(true);
		expect(principal.etats).not.toContain('jeton_refuse');
		const { sessions } = await api.lire<{ sessions: SessionVue[] }>(ROUTES.sessions);
		expect(sessions.map((s) => s.id)).toContain(session.id);
		// réabonnement par la connexion à la réouverture : l'écran du nouveau terminal (session reprise par --resume) revient
		// par une relecture
		expect(await jusqua(() => relecturesApres > relecturesAvant && relu.includes(`--resume","${session.id}`), DELAI), relu).toBe(true);
		expect(await jusqua(() => relu.includes('prêt')), relu).toBe(true);
	}, 120_000);

	it('jeton renouvelé puis redémarrage : jeton_refuse sans boucle, jeton effacé ; le nouveau jeton ouvre la connexion', async () => {
		await commandeMnemo({ dossier, dist, args: ['jeton', '--renouveler'] });
		const nouveau = readFileSync(join(dossier, '.mnemo', 'jeton'), 'utf8').trim();
		expect(nouveau).toMatch(/^[0-9a-f]{64}$/u);
		expect(nouveau).not.toBe(jeton);

		const { connexion } = principal.client;
		expect(await jusqua(() => connexion.etat() === 'ouverte')).toBe(true);
		await service!.arreter('SIGTERM');
		service = await lancerService({ dossier, dist, port });
		expect(service.jeton).toBe(nouveau);

		expect(await jusqua(() => connexion.etat() === 'jeton_refuse')).toBe(true);
		expect(principal.effaces).toEqual(['mnemo.jeton']);
		const tentatives = principal.sockets();
		await pause(2_000);
		expect(principal.sockets()).toBe(tentatives);
		expect(connexion.etat()).toBe('jeton_refuse');
		expect(principal.etats.filter((e) => e === 'jeton_refuse')).toHaveLength(1);

		const neuf = clientVers(port, nouveau);
		clients.push(neuf);
		expect(await jusqua(() => neuf.client.connexion.etat() === 'ouverte')).toBe(true);
		const { sessions } = await neuf.client.api.lire<{ sessions: SessionVue[] }>(ROUTES.sessions);
		if (terminaux) expect(sessions.map((s) => s.id)).toContain(session.id);
	}, 120_000);
});
