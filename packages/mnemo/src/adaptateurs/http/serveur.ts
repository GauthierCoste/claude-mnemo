import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { ROUTES } from '@mnemo/contrat';
import { TAILLE_MAX_DOCUMENT, tailleLisible } from '@mnemo/commun';
import { extractionDifferee } from '../../application/extraction-differee.ts';
import { creerPilote } from '../../application/pilote.ts';
import type { Dependances, Modeles, Pilotage } from '../../application/ports.ts';
import { modelesLocaux } from '../../infra/modeles/client-llama.ts';
import { migrerAncienGardien } from '../../infra/modeles/migration-gardien-dossier.ts';
import { dossierClaudeParDefaut, memoireClaude, projetsClaude } from '../../infra/memoire-claude.ts';
import { jetonDuDossier } from '../../infra/jeton-local.ts';
import { ecrireService, retirerService } from '../../infra/service-local.ts';
import { prendreVerrouService } from '../../infra/verrou-service.ts';
import { ErreurEspaceInsuffisant, nettoyerDepots, verifierPlace } from '../../infra/fichiers-dossier.ts';
import { preparerDossierLocal } from '../../infra/systeme.ts';
import { etatsGit } from './dossiers.ts';
import { dossiersRacine } from '../../infra/dossiers.ts';
import { dossiersAAmorcer } from '../../application/dossiers.ts';
import { lireReglagesMemoire, modifierReglagesMemoire } from '../../application/reglages-memoire.ts';
import { routesProfils } from './profils.ts';
import { routesReglages } from './reglages.ts';
import { routesClaudeDesktop } from './claude-desktop.ts';
import type { AppClaude } from './claude-desktop.ts';
import { fichierConfigClaudeDesktop } from '../../infra/config-claude-desktop.ts';
import { nodeDurable } from '../../infra/node-durable.ts';
import { choixDesTypesAConfirmer } from '../../application/types-du-coffre.ts';
import { CORPS_MAX, ErreurHttp, routes, trouverRoute } from './routes.ts';
import type { Reponse, Route } from './routes.ts';
import { ENTETES_SECURITE, hoteValide, jetonDeLEntete, jetonDuWebSocket, jetonValide, origineValide } from './securite.ts';
import { dossierInterface, servirInterface } from './statique.ts';
import { racineAffichee, titresDeLIndex } from './vues.ts';
import { creerHub } from './websocket.ts';
import { aprioriDesGestes } from '../../application/apriori.ts';
import { diffuserModeles, vueModeles } from './diffusion-modeles.ts';
import { routesLots } from './lots.ts';
import { versionMnemo } from '../../infra/version.ts';

/** `main.ts` de Mnemo : l'entrée `mnemo` de l'app Claude le lance (`mnemo mcp`), comme la déclaration à Claude Code. */
const MAIN = fileURLToPath(new URL('../cli/main.ts', import.meta.url));

/** Adresse d'écoute : jamais `0.0.0.0`, `::` ni `localhost` résolu. */
const ADRESSE = '127.0.0.1';
/** Disques qui ne distinguent pas la casse par défaut (consignes vérifiées). */
const SANS_CASSE = process.platform === 'darwin' || process.platform === 'win32';

/** Réglages (tests surtout) : intervalles du ping et du sondage, battement du pilote, journal (stderr par défaut). */
/** Relecture du verrou du dossier (toujours le nôtre ?). */
const SURVEILLANCE_VERROU_MS = 1000;

export type ReglagesService = {
	pingMs?: number;
	sondageMs?: number;
	/** Sondage de secours de l'état des modèles (`SONDAGE_MODELES_MS` par défaut). */
	sondageModelesMs?: number;
	battementMs?: number;
	journal?: (message: string) => void;
	/**
	 * Taille maximale d'un dépôt (`TAILLE_MAX_DOCUMENT`, 10 Go, par défaut). Abaissée par les tests ; point de branchement
	 * d'un futur réglage de l'utilisateur.
	 */
	depotMax?: number;
	/** Délai de réception du corps d'une requête JSON (`DELAI_CORPS_MS` par défaut ; abaissé par les tests). */
	delaiCorpsMs?: number;
	/** Inactivité tolérée pendant la réception d'un dépôt (`INACTIVITE_DEPOT_MS` par défaut ; abaissée par les tests). */
	inactiviteDepotMs?: number;
};

export type Service = {
	port: number;
	jeton: string;
	/** Instant du démarrage (`service.json`), qui le distingue d'un autre service du même dossier au même jeton. */
	demarre: number;
	/** Adresse réellement écoutée. */
	adresse: string;
	/** Arrête les sessions (`arreterTout`), attend les tâches de fond (épisodes), ferme le serveur, retire `service.json`. */
	arreter(): Promise<void>;
	/** Pids des sessions que le pilote fait tourner au moment de l'appel, jamais un pid lu seul dans l'état (tués de façon synchrone à la sortie du processus). */
	pids(): number[];
	/** Résolue quand la relance des sessions du démarrage est faite (jamais rejetée). */
	pret: Promise<void>;
	/**
	 * Résolue si le service s'arrête de lui-même parce que son verrou n'est plus le sien (un autre service l'a repris) : il ne
	 * relance plus rien, arrête ses sessions et ferme ; le processus n'a plus qu'à sortir.
	 */
	perdu: Promise<void>;
	/** Résolue par `POST /api/arret` : le processus s'arrête comme sur SIGTERM (sous Windows, un signal tue sans arrêt propre). */
	arretDemande: Promise<void>;
};

/** Un autre service tient déjà ce dossier (`pid` : le sien, s'il est connu). */
export class ErreurServiceOccupe extends Error {
	readonly pid: number | null;
	constructor(pid: number | null) {
		super(`Un service Mnemo tourne déjà pour ce dossier${pid === null ? '' : ` (pid ${pid})`}.`);
		this.name = 'ErreurServiceOccupe';
		this.pid = pid;
	}
}

/** Excès de corps lu (et jeté) avant de répondre 413 ; au-delà, la réponse part aussitôt et la connexion est fermée. */
const EXCES_LU = 4;

/**
 * Corps d'une requête, `max` octets au plus : au-delà (annoncé ou reçu), `ErreurHttp` 413. Jusqu'à `EXCES_LU` × `max`, le reste
 * du corps est lu et jeté avant la réponse : le client, qui écrit encore, la reçoit bien (Node coupe sinon la connexion sous
 * ses écritures). Au-delà, 413 aussitôt, connexion fermée.
 */
function lireCorps(req: IncomingMessage, max: number, delaiMs: number): Promise<Buffer> {
	const trop = (fermer: boolean) => new ErreurHttp(413, `Corps trop gros (${max} octets au plus).`, fermer);
	const annonce = Number(req.headers['content-length']);
	if (Number.isFinite(annonce) && annonce > EXCES_LU * max) return Promise.reject(trop(true));
	if (req.complete) return Promise.resolve(Buffer.alloc(0));
	return new Promise((resoudre, rejeter) => {
		const morceaux: Buffer[] = [];
		let taille = 0;
		let fini = false;
		// le délai d'une heure du serveur ne vaut que pour les dépôts : un corps JSON a le délai court d'avant
		const minuteur = setTimeout(() => finir(new ErreurHttp(408, 'Corps de la requête reçu trop lentement.', true)), delaiMs);
		const finir = (resultat: Buffer | Error): void => {
			if (fini) return;
			fini = true;
			clearTimeout(minuteur);
			morceaux.length = 0;
			if (resultat instanceof Error) rejeter(resultat);
			else resoudre(resultat);
		};
		req.on('data', (m: Buffer) => {
			if (fini) return;
			taille += m.byteLength;
			if (taille > EXCES_LU * max) finir(trop(true));
			else if (taille > max) morceaux.length = 0;
			else morceaux.push(m);
		});
		req.on('end', () => finir(taille > max ? trop(false) : Buffer.concat(morceaux)));
		req.on('error', (e) => finir(e));
	});
}

/** Corps d'un dépôt refusé lu et jeté avant la réponse, au plus : au-delà, la réponse part et la connexion est fermée. */
const VIDAGE_MAX = 16 * 1024 * 1024;
/**
 * Durée maximale de réception d'une requête, pour le serveur (`requestTimeout`) : un dépôt de 10 Go sur un disque lent tient
 * dans ce délai. Les autres routes ont leur propre délai, court (`DELAI_CORPS_MS`), et un dépôt sans données reçues pendant
 * `INACTIVITE_DEPOT_MS` est coupé (temporaire retiré).
 */
const DELAI_REQUETE_MS = 60 * 60 * 1000;
/** Réception du corps d'une requête JSON, au plus : le délai par défaut de Node (`requestTimeout`, 5 min). */
const DELAI_CORPS_MS = 5 * 60 * 1000;
/** Dépôt : silence toléré entre deux morceaux reçus. */
const INACTIVITE_DEPOT_MS = 2 * 60 * 1000;

/**
 * Corps d'une requête en flux. Une sortie anticipée (refus) ne détruit pas la requête : la réponse doit encore partir. Une
 * fois le corps lu en entier, le délai d'inactivité de la socket (`req.setTimeout`) est levé : le travail qui suit (copie de
 * repli de plusieurs minutes, `sync`) ne coupe plus la connexion avant la réponse.
 */
export async function* fluxDuCorps(req: IncomingMessage): AsyncGenerator<Uint8Array> {
	for await (const morceau of req.iterator({ destroyOnReturn: false })) yield morceau as Uint8Array;
	req.setTimeout(0);
}

/**
 * Lit et jette le reste d'un corps en flux que la route n'a pas consommé (refus en cours d'envoi, fichier déjà là), jusqu'à
 * `VIDAGE_MAX` octets : le client, qui écrit encore, reçoit bien la réponse. Rend vrai si le corps a été lu jusqu'au bout.
 */
function vider(req: IncomingMessage): Promise<boolean> {
	if (req.complete) return Promise.resolve(true);
	if (req.destroyed) return Promise.resolve(false);
	return new Promise((resoudre) => {
		let jetes = 0;
		const finir = (complet: boolean): void => {
			req.off('data', surDonnees);
			req.off('end', surFin);
			req.off('error', surErreur);
			req.off('close', surErreur);
			req.pause();
			resoudre(complet);
		};
		const surDonnees = (m: Buffer): void => {
			jetes += m.byteLength;
			if (jetes > VIDAGE_MAX) finir(false);
		};
		const surFin = (): void => finir(true);
		const surErreur = (): void => finir(false);
		req.on('data', surDonnees);
		req.once('end', surFin);
		req.once('error', surErreur);
		req.once('close', surErreur);
		req.resume();
	});
}

function repondre(res: ServerResponse, r: Reponse, fermer = false): void {
	if (res.headersSent) return;
	const corps = Buffer.from(JSON.stringify(r.corps ?? null));
	res.writeHead(r.statut, {
		...ENTETES_SECURITE,
		'content-type': 'application/json; charset=utf-8',
		'content-length': corps.byteLength,
		...(fermer ? { connection: 'close' } : {}),
	});
	res.end(corps);
}

const RAISONS: Record<number, string> = { 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden' };

/** Réponse écrite directement sur la socket (WebSocket refusé, requête illisible), avec les mêmes en-têtes de sécurité. */
function repondreBrut(socket: Duplex, statut: number, message: string): void {
	const corps = JSON.stringify({ erreur: message });
	const lignes = [
		`HTTP/1.1 ${statut} ${RAISONS[statut] ?? 'Error'}`,
		...Object.entries(ENTETES_SECURITE).map(([k, v]) => `${k}: ${v}`),
		'content-type: application/json; charset=utf-8',
		`content-length: ${Buffer.byteLength(corps)}`,
		'connection: close',
	];
	socket.end(`${lignes.join('\r\n')}\r\n\r\n${corps}`);
}

/**
 * Le service local d'un dossier Mnemo : API HTTP (routes du contrat, JSON) et WebSocket, sur 127.0.0.1 seulement, derrière un
 * jeton aléatoire. Un seul par dossier (`.mnemo/service.verrou`) ; `.mnemo/service.json` (`{ pid, port, jeton, demarre }`, 0600)
 * dit aux hooks où le trouver. Au démarrage, les sessions à relancer le sont (`reprendreAuDemarrage`) et le cache de vecteurs
 * est préchauffé, en arrière-plan. `port` : celui demandé (0 ou absent : un port libre).
 */
/** À l'arrêt, l'extraction en arrière-plan en cours est attendue au plus ce temps. */
const ATTENTE_EXTRACTION_ARRET_MS = 5000;

export async function demarrerService(options: {
	racine: string;
	port?: number;
	dep: Dependances;
	pil: Pilotage;
	reglages?: ReglagesService;
	/** Dossier de l'interface construite ; par défaut `dossierInterface()` (`MNEMO_UI_DIST`, sinon `packages/ui/dist`). */
	interface?: string;
	/** Configuration de Claude Code lue (jamais écrite) par `amorce` ; par défaut `CLAUDE_CONFIG_DIR`, sinon `~/.claude`. */
	dossierClaude?: string;
	/** Modèles locaux (état, démarrage sur demande) ; par défaut ceux de la machine (`modelesLocaux`). */
	modeles?: Modeles;
	/** Variable d'environnement qui a fixé `port` (`MNEMO_PORT`) : le réglage `service.port` est alors sans effet. */
	portFixePar?: string;
	/**
	 * App Claude (Claude Desktop) : fichier de configuration, dossier personnel, Node et `main.ts` de l'entrée `mnemo` ; par
	 * défaut ceux de la machine (`fichierConfigClaudeDesktop`, `homedir()`, `nodeDurable()`, ce `main.ts`).
	 */
	appClaude?: Partial<Omit<AppClaude, 'racine'>>;
}): Promise<Service> {
	const { racine, dep, pil } = options;
	const dossierUi = options.interface ?? dossierInterface();
	const reglages = options.reglages ?? {};
	const journal =
		reglages.journal ??
		((m: string) => {
			try {
				process.stderr.write(`mnemo service : ${m}\n`);
			} catch {
				// terminal fermé (EPIPE) : le journal est perdu, le service continue
			}
		});
	const depotMax = reglages.depotMax ?? TAILLE_MAX_DOCUMENT;
	preparerDossierLocal(racine);
	const verrou = await prendreVerrouService(racine);
	if (!verrou.pris) throw new ErreurServiceOccupe(verrou.pid);

	// temporaires de dépôts interrompus par un arrêt brutal (le service est seul à en écrire)
	const orphelins = await nettoyerDepots(racine);
	if (orphelins > 0) journal(`${orphelins} dépôt(s) interrompu(s) retiré(s) de .mnemo/depots/.`);

	// extraction des documents à part de la recherche, qui la réveille (une recherche n'attend jamais un document de plusieurs Go)
	const differee = dep.extractionDifferee === undefined ? extractionDifferee(dep, journal) : null;
	if (differee !== null) dep.extractionDifferee = differee;

	// le jeton du dossier (`.mnemo/jeton`), repris d'un démarrage à l'autre : le jeton gardé par le navigateur reste valable
	const jeton = jetonDuDossier(racine, journal);
	const pilote = creerPilote(dep, pil, reglages.battementMs === undefined ? {} : { battementMs: reglages.battementMs });
	let port = 0;
	let arrete = false;

	/** Tâches de fond (épisodes de `fin`, git de `debut`, relance, préchauffage) : attendues avant l'arrêt. */
	const taches = new Set<Promise<unknown>>();
	const enFond = (tache: Promise<unknown>): void => {
		const suivie = tache.catch((erreur: unknown) => journal(`tâche de fond en échec : ${erreur instanceof Error ? erreur.message : String(erreur)}`));
		taches.add(suivie);
		void suivie.finally(() => taches.delete(suivie));
	};

	// ancien gardien des modèles propre à ce dossier (jusqu'à la 1.5) : arrêté, ses fichiers retirés ; un seul gardien désormais
	enFond(
		migrerAncienGardien(racine).then((r) => {
			if (r === null) return;
			const bilan = typeof r === 'object' ? `${r.enChargement} serveur(s) encore en chargement` : { arrete: 'arrêté', perime: 'état périmé retiré', rien: 'rien en marche, état retiré' }[r];
			journal(`ancien gardien des modèles de ce dossier : ${bilan}.`);
		}),
	);

	const modeles = options.modeles ?? modelesLocaux(racine);
	// a priori des gestes entre sessions : lu une fois en arrière-plan, puis seulement les gestes nouveaux
	const apriori = aprioriDesGestes(pil.etat, { chemins: async () => (await dep.index.titres()).map((t) => t.chemin), journal });
	enFond(apriori.actualiser({ ecartees: true }));
	const hub = creerHub({
		suggestions: (session) => apriori.suggestions(session),
		etatModeles: async () => vueModeles(await modeles.etat()),
		pilote,
		etat: pil.etat,
		titres: () => titresDeLIndex(dep.index),
		versionDesLots: () => dep.lots.version(),
		racine,
		journal,
		...(reglages.pingMs === undefined ? {} : { pingMs: reglages.pingMs }),
		...(reglages.sondageMs === undefined ? {} : { sondageMs: reglages.sondageMs }),
	});
	// état des modèles de la machine, diffusé quand il change (surveillance de ses fichiers, sondage de secours)
	const diffusionModeles = diffuserModeles({
		modeles,
		diffuser: hub.diffuser,
		journal,
		...(reglages.sondageModelesMs === undefined ? {} : { sondageMs: reglages.sondageModelesMs }),
	});
	/** Processus de session tenus ici : session → pid. */
	const pids = new Map<string, number>();
	pilote.surChangement((s) => {
		if (s.pid !== null && pilote.enCours(s.id)) pids.set(s.id, s.pid);
		else if (s.pid === null) pids.delete(s.id);
		hub.signaler(s);
	});

	const { promise: arretDemande, resolve: demanderArret } = Promise.withResolvers<void>();

	const dossiers = dossiersRacine(racine);
	const dossierClaude = options.dossierClaude ?? dossierClaudeParDefaut();
	const table: Route[] = [
		...routes({
			dep,
			pil,
			pilote,
			racine,
			sansCasse: SANS_CASSE,
			enFond,
			diffuser: hub.diffuser,
			signaler: hub.signaler,
			arrete: () => arrete,
			identite: { racine: racineAffichee(racine, homedir()), racineAbsolue: racine, version: versionMnemo() },
			etatGit: etatsGit(pil.depot),
			dossiers,
			memoireClaude: memoireClaude(dossierClaude),
			modeles,
			relireModeles: diffusionModeles.relire,
			projetsClaude: projetsClaude(racine, () => dossiersAAmorcer(dossiers), { dossierClaude }),
			journal,
			depotMax,
			apriori,
		}),
		...routesProfils(dep, () => hub.diffuser({ type: 'memoire', modifieeMs: Date.now() })),
		...routesLots(dep, hub.diffuser),
		...routesClaudeDesktop({
			fichier: options.appClaude?.fichier ?? fichierConfigClaudeDesktop(process.platform, homedir(), process.env),
			maison: options.appClaude?.maison ?? homedir(),
			node: options.appClaude?.node ?? nodeDurable(),
			main: options.appClaude?.main ?? MAIN,
			racine,
		}),
		...routesReglages(racine, options.portFixePar === undefined ? {} : { 'service.port': options.portFixePar }, (coches) => choixDesTypesAConfirmer(dep, coches), {
			lire: () => lireReglagesMemoire(dep),
			modifier: async (valeurs) => {
				const r = await modifierReglagesMemoire(dep, valeurs);
				if (r.ok && r.commit !== null) hub.diffuser({ type: 'memoire', modifieeMs: Date.now() });
				return r;
			},
		}),
		{
			methode: 'POST',
			chemin: ROUTES.arret,
			action: async () => {
				journal('arrêt demandé par l’API (mnemo arreter).');
				// après l'envoi de la réponse : l'arrêt ferme toutes les connexions
				setImmediate(() => demanderArret());
				return { statut: 202, corps: { ok: true } };
			},
		},
	];

	const traiter = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
		if (!hoteValide(req.headers.host, port)) return repondre(res, { statut: 403, corps: { erreur: 'Hôte refusé.' } }, true);
		// `Origin`, si présente, doit être l'adresse du service (comme pour le WebSocket) : une page d'un autre site est refusée
		const origine = req.headers.origin;
		if (!origineValide(typeof origine === 'string' ? origine : undefined, req.headers.host!)) return repondre(res, { statut: 403, corps: { erreur: 'Origine refusée.' } }, true);
		const url = new URL(req.url ?? '/', `http://${ADRESSE}:${port}`);
		// Les fichiers de l'interface, hors de `/api/`, sans jeton : ils ne contiennent aucun secret.
		if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) {
			if (await servirInterface(res, { dossier: dossierUi, port, methode: req.method ?? '', chemin: url.pathname })) return;
			return repondre(res, { statut: 404, corps: { erreur: 'Introuvable.' } });
		}
		if (!jetonValide(jetonDeLEntete(req.headers.authorization), jeton)) return repondre(res, { statut: 401, corps: { erreur: 'Jeton absent ou invalide.' } }, true);
		const trouvee = trouverRoute(table, req.method ?? '', url.pathname);
		if (trouvee === null) return repondre(res, { statut: 404, corps: { erreur: 'Route inconnue.' } });
		const { route, id } = trouvee;
		const enFlux = route.corps === 'flux';
		if (enFlux) {
			// dépôt annoncé au-delà de la limite : refusé sans rien écrire ; un corps court est lu et jeté d'abord (le client, qui
			// l'écrit encore, reçoit ainsi la réponse), un gros est coupé aussitôt
			const annonce = Number(req.headers['content-length']);
			if (Number.isFinite(annonce) && annonce > depotMax) {
				if (annonce <= VIDAGE_MAX) await vider(req);
				return repondre(res, { statut: 413, corps: { erreur: `Document trop volumineux : ${tailleLisible(annonce)} (plus de ${tailleLisible(depotMax)}).` } }, true);
			}
			// ni s'il ne tient pas sur le disque
			if (Number.isFinite(annonce)) {
				try {
					await verifierPlace(racine, url.searchParams.get('vers') ?? '', annonce);
				} catch (erreur) {
					if (!(erreur instanceof ErreurEspaceInsuffisant)) throw erreur;
					if (annonce <= VIDAGE_MAX) await vider(req);
					return repondre(res, { statut: 507, corps: { erreur: erreur.message } }, true);
				}
			}
		}
		// route en flux : son corps n'est lu que par elle, morceau par morceau
		const corps = enFlux ? Promise.resolve(Buffer.alloc(0)) : lireCorps(req, CORPS_MAX, reglages.delaiCorpsMs ?? DELAI_CORPS_MS);
		// dépôt : coupé s'il ne reçoit plus rien (le flux échoue, le temporaire est retiré)
		if (enFlux) req.setTimeout(reglages.inactiviteDepotMs ?? INACTIVITE_DEPOT_MS, () => req.destroy(new Error('dépôt interrompu : plus rien reçu')));
		// un corps refusé est rendu même si la route ne le lit pas
		corps.catch(() => {});
		// connexion fermée avant la réponse (le client a abandonné) : la route peut s'arrêter
		const abandon = new AbortController();
		res.on('close', () => {
			if (!res.writableFinished) abandon.abort();
		});
		/** Réponse d'une route en flux : le reste du corps non lu est jeté (borné) ; s'il en reste, la connexion est fermée. */
		const repondreApresFlux = async (r: Reponse, fermer: boolean): Promise<void> => {
			const complet = !enFlux || (await vider(req));
			repondre(res, r, fermer || !complet);
		};
		try {
			const r = await route.action({
				params: url.searchParams,
				id,
				signal: abandon.signal,
				entete: (nom) => {
					const v = req.headers[nom.toLowerCase()];
					return typeof v === 'string' ? v : null;
				},
				flux: () => {
					if (!enFlux) throw new Error('Corps en flux réservé aux routes « flux ».');
					return fluxDuCorps(req);
				},
				json: async () => {
					const texte = (await corps).toString('utf8');
					if (texte.trim() === '') return {};
					try {
						return JSON.parse(texte) as unknown;
					} catch {
						throw new ErreurHttp(400, 'Corps illisible : JSON attendu.');
					}
				},
			});
			// tout le corps doit avoir été accepté (taille), même par une route qui ne l'a pas lu
			await corps;
			await repondreApresFlux(r, false);
		} catch (erreur) {
			// personne n'attend plus la réponse
			if (abandon.signal.aborted) return;
			if (erreur instanceof ErreurHttp) return repondreApresFlux({ statut: erreur.statut, corps: { erreur: erreur.message } }, erreur.fermer);
			journal(`erreur sur ${req.method ?? ''} ${url.pathname} : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
			await repondreApresFlux({ statut: 500, corps: { erreur: `Erreur interne : ${erreur instanceof Error ? erreur.message : String(erreur)}` } }, false);
		}
	};

	const serveur = createServer((req, res) => {
		traiter(req, res).catch((erreur: unknown) => {
			journal(`réponse impossible : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
			repondre(res, { statut: 500, corps: { erreur: 'Erreur interne.' } });
		});
	});
	// un gros dépôt peut prendre plusieurs minutes (300 s par défaut dans Node) ; les autres routes gardent leur délai court
	serveur.requestTimeout = DELAI_REQUETE_MS;
	serveur.on('upgrade', (req: IncomingMessage, socket: Duplex, tete: Buffer) => {
		socket.on('error', () => {});
		const url = new URL(req.url ?? '/', `http://${ADRESSE}:${port}`);
		if (!hoteValide(req.headers.host, port)) return repondreBrut(socket, 403, 'Hôte refusé.');
		const origine = req.headers.origin;
		if (!origineValide(typeof origine === 'string' ? origine : undefined, req.headers.host!)) return repondreBrut(socket, 403, 'Origine refusée.');
		const protocoles = req.headers['sec-websocket-protocol'];
		if (url.pathname !== ROUTES.ws || !jetonValide(jetonDuWebSocket(typeof protocoles === 'string' ? protocoles : undefined, url.searchParams.get('jeton')), jeton))
			return repondreBrut(socket, 401, 'Jeton absent ou invalide.');
		hub.accueillir(req, socket, tete);
	});
	serveur.on('clientError', (_erreur, socket) => {
		if (socket.writable) repondreBrut(socket, 400, 'Requête illisible.');
		else socket.destroy();
	});

	try {
		await new Promise<void>((resoudre, rejeter) => {
			serveur.once('error', rejeter);
			serveur.listen(options.port ?? 0, ADRESSE, () => {
				serveur.off('error', rejeter);
				resoudre();
			});
		});
	} catch (erreur) {
		diffusionModeles.fermer();
		hub.fermer();
		verrou.liberer();
		throw erreur;
	}
	const adresse = serveur.address() as AddressInfo;
	port = adresse.port;
	const inscrit = { pid: process.pid, port, jeton, demarre: Date.now() };
	ecrireService(racine, inscrit);

	let arret: Promise<void> | null = null;
	const arreter = (): Promise<void> => {
		arret ??= (async () => {
			arrete = true;
			clearInterval(surveillance);
			// le serveur reste ouvert pendant l'arrêt des sessions : leur hook `fin` passe encore par lui
			await pilote.arreterTout();
			while (taches.size > 0) await Promise.allSettled([...taches]);
			if (differee !== null) {
				// l'extraction en cours, attendue un peu : au-delà, son fil s'arrête avec le processus (réservation reprise plus tard)
				let minuteur: ReturnType<typeof setTimeout> | undefined;
				await Promise.race([differee.arreter(), new Promise<void>((r) => (minuteur = setTimeout(r, ATTENTE_EXTRACTION_ARRET_MS)))]);
				clearTimeout(minuteur);
			}
			diffusionModeles.fermer();
			hub.fermer();
			await new Promise<void>((resoudre) => {
				serveur.close(() => resoudre());
				serveur.closeAllConnections();
			});
			retirerService(racine, inscrit);
			verrou.liberer();
		})();
		return arret;
	};

	// défense en profondeur : un verrou qui n'est plus le nôtre (deux services sur un dossier) → arrêt, rien relancé
	let signalerPerte: () => void = () => {};
	const perdu = new Promise<void>((r) => {
		signalerPerte = r;
	});
	const verifierVerrou = (moment: string): boolean => {
		if (arrete || verrou.tenu()) return true;
		journal(`verrou du dossier repris par un autre service (${moment}) : arrêt, aucune session relancée.`);
		void arreter().finally(signalerPerte);
		return false;
	};
	const surveillance = setInterval(() => verifierVerrou('surveillance'), reglages.sondageMs ?? SURVEILLANCE_VERROU_MS);
	surveillance.unref();

	// relance des sessions du service précédent, puis préchauffage du cache de vecteurs (les hooks servis ici en profitent)
	const relance = (async () => {
		if (!verifierVerrou('avant la relance')) return;
		const relancees = await pilote.reprendreAuDemarrage();
		if (relancees.length > 0) journal(`${relancees.length} session(s) relancée(s).`);
	})();
	enFond(relance);
	enFond(
		relance
			.catch(() => {})
			.then(async () => {
				const modele = dep.sens.modele();
				if (modele !== null && !arrete) await dep.index.plusProches(modele, new Float32Array(1), {}, 1);
			}),
	);

	return {
		port,
		jeton,
		demarre: inscrit.demarre,
		adresse: adresse.address,
		pids: () => [...pids].filter(([id]) => pilote.enCours(id)).map(([, pid]) => pid),
		pret: relance.catch(() => {}),
		perdu,
		arretDemande,
		arreter,
	};
}
