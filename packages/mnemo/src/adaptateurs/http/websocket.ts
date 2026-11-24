import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { CODE_FERMETURE_LENT, ENTREE_MAX_OCTETS, MESSAGE_CLIENT_MAX_OCTETS, PROTOCOLE_WS } from '@mnemo/contrat';
import type { MessageClient, MessageServeur, SessionVue } from '@mnemo/contrat';
import type { Pilote } from '../../application/pilote.ts';
import type { EtatSessions } from '../../application/ports.ts';
import type { Session } from '../../domaine/session.ts';
import { vueServie, vueSession } from './vues.ts';
import { DOSSIER_MEMOIRE } from '../../domaine/dossier-memoire.ts';
import { estObjet } from '../../domaine/valeurs.ts';

/** Au-delà de ce qui attend d'être envoyé à un client, il est trop lent : fermé (`CODE_FERMETURE_LENT`), sa sortie n'est plus envoyée. */
export const RETARD_MAX_OCTETS = 1024 * 1024;
/** Ping des clients ; sans pong d'ici le suivant, le client est oublié. */
export const PING_MS = 30_000;
/** Lecture de l'état des sessions et du dernier commit de la mémoire (hooks et écritures passés hors du service). */
export const SONDAGE_MS = 1000;
/** Messages gardés pour un client pas encore accueilli (`sessions` d'abord). */
const ATTENTE_MAX = 1000;

type Client = {
	ws: WebSocket;
	/** Abonnements aux terminaux : session → désabonnement. */
	abonnements: Map<string, () => void>;
	/** A répondu au dernier ping. */
	vivant: boolean;
	/** Fermé pour lenteur : plus rien ne lui est envoyé. */
	lent: boolean;
	/** `sessions` envoyé : avant, les messages attendent (dans l'ordre). */
	accueilli: boolean;
	enAttente: MessageServeur[];
};

export type Hub = {
	/** Prend en charge une demande de WebSocket déjà vérifiée (jeton, `Host`, `Origin`). */
	accueillir(req: IncomingMessage, socket: Duplex, tete: Buffer): void;
	diffuser(m: MessageServeur): void;
	/** Une session a changé : diffusée si sa vue a changé depuis la dernière diffusée. */
	signaler(s: Session): void;
	fermer(): void;
};

/** Message du client si sa forme est valide, sinon null (ignoré). */
function lireMessage(brut: string): MessageClient | null {
	let m: unknown;
	try {
		m = JSON.parse(brut);
	} catch {
		return null;
	}
	if (!estObjet(m) || typeof m.session !== 'string' || m.session.length > 100) return null;
	switch (m.type) {
		case 'abonner':
		case 'desabonner':
			return { type: m.type, session: m.session };
		case 'entree':
			// en octets UTF-8, comme le client découpe un collage (contrat)
			return typeof m.donnees === 'string' && Buffer.byteLength(m.donnees, 'utf8') <= ENTREE_MAX_OCTETS ? { type: 'entree', session: m.session, donnees: m.donnees } : null;
		case 'taille':
			return typeof m.colonnes === 'number' && typeof m.lignes === 'number' ? { type: 'taille', session: m.session, colonnes: m.colonnes, lignes: m.lignes } : null;
		default:
			return null;
	}
}

/**
 * Les clients WebSocket du service. À la connexion : `sessions` d'abord (l'interface s'y fie après une reconnexion), puis les
 * messages diffusés : `session` (pilote, et état relu chaque seconde quand `derniereModificationMs` bouge : hooks passés hors
 * service ; seules les sessions dont la vue a changé), `servi` (route du hook, et journal relu au même sondage : un hook en
 * repli local), `memoire` (nouveau commit de la mémoire, relu chaque seconde), `lots` (lots d'informations proposés par un
 * serveur MCP ou décidés, relus au même sondage). `abonner` → `relecture` du tampon puis
 * `sortie` ; `entree` et `taille` vont au terminal. Un client lent est fermé sans jamais freiner le terminal ; un client qui
 * ne répond plus aux pings est oublié.
 */
export function creerHub(o: {
	pilote: Pilote;
	etat: EtatSessions;
	/** Titres des fiches de l'index, pour les vues `servi` (les mêmes que celles de la route du hook). */
	titres: () => Promise<ReadonlyMap<string, string>>;
	/** Signature des lots d'informations (`Lots.version`) ; absente : rien n'est sondé. */
	versionDesLots?: () => Promise<string>;
	racine: string;
	pingMs?: number;
	sondageMs?: number;
	journal: (m: string) => void;
}): Hub {
	// l'interface propose `mnemo` et `mnemo.jeton.<jeton>` : le service choisit `mnemo`, et ne renvoie jamais le jeton
	const wss = new WebSocketServer({
		noServer: true,
		maxPayload: MESSAGE_CLIENT_MAX_OCTETS,
		perMessageDeflate: false,
		handleProtocols: (protocoles) => (protocoles.has(PROTOCOLE_WS) ? PROTOCOLE_WS : false),
	});
	const clients = new Set<Client>();
	/** Dernière vue diffusée de chaque session (JSON), pour ne diffuser que ce qui change. */
	const diffusees = new Map<string, string>();
	/** Dernière entrée `servi` connue de chaque session (JSON) : le sondage diffuse celles journalisées hors service. */
	const serviesConnues = new Map<string, string>();
	/** Dernière entrée du journal examinée par le sondage de chaque session (JSON brut, avant mise en vue). */
	const examinees = new Map<string, string>();
	let ferme = false;

	const oublier = (c: Client): void => {
		for (const desabonner of c.abonnements.values()) desabonner();
		c.abonnements.clear();
		c.enAttente.length = 0;
		clients.delete(c);
	};

	const fermerLent = (c: Client): void => {
		if (c.lent) return;
		c.lent = true;
		for (const desabonner of c.abonnements.values()) desabonner();
		c.abonnements.clear();
		c.ws.close(CODE_FERMETURE_LENT, 'client trop lent');
	};

	/** Envoie à un client ; trop de retard → fermé, et ce message n'est pas envoyé. */
	const envoyer = (c: Client, m: MessageServeur): void => {
		if (c.lent || c.ws.readyState !== WebSocket.OPEN) return;
		if (!c.accueilli) {
			if (c.enAttente.length < ATTENTE_MAX) c.enAttente.push(m);
			return;
		}
		if (c.ws.bufferedAmount > RETARD_MAX_OCTETS) {
			fermerLent(c);
			return;
		}
		c.ws.send(JSON.stringify(m));
	};

	const diffuser = (m: MessageServeur): void => {
		if (m.type === 'servi') {
			// déjà diffusée (le sondage a pu la voir avant la route du hook) : pas deux fois
			const texte = JSON.stringify(m.entree);
			if (serviesConnues.get(m.entree.session) === texte) return;
			serviesConnues.set(m.entree.session, texte);
		}
		for (const c of clients) envoyer(c, m);
	};

	/**
	 * Dernière entrée servie de la session : diffusée si elle n'est pas celle déjà connue (un hook en repli local l'a journalisée
	 * sans passer par le service). `reference` : notée sans rien diffuser.
	 */
	const sonderServi = async (s: Session, reference: boolean): Promise<void> => {
		const [derniere] = await o.etat.servis(s.id, 1);
		if (derniere === undefined) return;
		// déjà examinée (à chaque seconde, pour chaque session) : les titres de l'index ne sont lus que pour une entrée nouvelle
		const brute = JSON.stringify(derniere);
		if (examinees.get(s.id) === brute) return;
		examinees.set(s.id, brute);
		const vue = vueServie(derniere, await o.titres());
		const texte = JSON.stringify(vue);
		if (serviesConnues.get(s.id) === texte) return;
		if (reference) serviesConnues.set(s.id, texte);
		else diffuser({ type: 'servi', entree: vue });
	};

	const signaler = (s: Session): void => {
		const vue = vueSession(s, o.pilote.enCours(s.id));
		const texte = JSON.stringify(vue);
		const avant = diffusees.get(s.id);
		if (avant === texte) return;
		diffusees.set(s.id, texte);
		diffuser({ type: 'session', session: vue });
		// une session qui se termine perd ses écartés (effacés par l'état) : l'interface l'apprend
		if (vue.etat === 'terminee' && (avant === undefined || (JSON.parse(avant) as SessionVue).etat !== 'terminee')) diffuser({ type: 'ecartes', session: s.id, ecartes: [] });
	};

	const traiter = (c: Client, m: MessageClient): void => {
		switch (m.type) {
			case 'abonner': {
				c.abonnements.get(m.session)?.();
				const abonnement = o.pilote.abonner(m.session, (donnees) => envoyer(c, { type: 'sortie', session: m.session, donnees }));
				envoyer(c, { type: 'relecture', session: m.session, donnees: abonnement?.relecture ?? '' });
				if (abonnement !== null) c.abonnements.set(m.session, abonnement.desabonner);
				else c.abonnements.delete(m.session);
				return;
			}
			case 'desabonner':
				c.abonnements.get(m.session)?.();
				c.abonnements.delete(m.session);
				return;
			case 'entree':
				o.pilote.entree(m.session, m.donnees);
				return;
			case 'taille':
				o.pilote.taille(m.session, m.colonnes, m.lignes);
		}
	};

	wss.on('connection', (ws: WebSocket) => {
		const c: Client = { ws, abonnements: new Map(), vivant: true, lent: false, accueilli: false, enAttente: [] };
		clients.add(c);
		ws.on('pong', () => {
			c.vivant = true;
		});
		ws.on('close', () => oublier(c));
		ws.on('error', () => oublier(c));
		// `sessions` d'abord ; les messages du client attendent qu'il soit parti
		const accueil = (async () => {
			let sessions: Session[] = [];
			try {
				sessions = await o.etat.lister();
			} catch (erreur) {
				o.journal(`sessions illisibles à l'accueil d'un client : ${(erreur as Error).message}`);
			}
			if (c.ws.readyState !== WebSocket.OPEN) return;
			c.ws.send(JSON.stringify({ type: 'sessions', sessions: sessions.map((s) => vueSession(s, o.pilote.enCours(s.id))) } satisfies MessageServeur));
			c.accueilli = true;
			for (const m of c.enAttente.splice(0)) envoyer(c, m);
		})();
		ws.on('message', (donnees, binaire) => {
			if (binaire) return;
			const m = lireMessage(String(donnees));
			if (m !== null) void accueil.then(() => traiter(c, m));
		});
	});

	// ping : sans pong depuis le précédent, le client est parti (ses abonnements avec lui)
	const ping = setInterval(() => {
		for (const c of clients) {
			if (!c.vivant) {
				c.ws.terminate();
				oublier(c);
				continue;
			}
			c.vivant = false;
			try {
				c.ws.ping();
			} catch {
				// déjà fermé
			}
		}
	}, o.pingMs ?? PING_MS);

	// sondage : hooks passés hors service (état), écritures d'autres processus (commit de la mémoire)
	let derniereModification: number | null = null;
	let dernierCommit: string | null = null;
	let versionDesLots: string | null = null;
	let enCours = false;
	const journalGit = join(o.racine, DOSSIER_MEMOIRE, '.git', 'logs', 'HEAD');
	/** Instant de la lecture précédente de l'état : une session inconnue et terminée n'est diffusée que si elle a bougé depuis. */
	let derniereLecture = 0;
	const sonder = async (): Promise<void> => {
		const lecture = Date.now();
		const modification = await o.etat.derniereModificationMs();
		if (derniereModification === null) {
			// référence : les vues actuelles, sans rien diffuser (le pilote a pu en signaler entre-temps : les siennes restent)
			for (const s of await o.etat.lister({ archivees: true })) {
				if (!diffusees.has(s.id)) diffusees.set(s.id, JSON.stringify(vueSession(s, o.pilote.enCours(s.id))));
				if (s.etat !== 'terminee' && !serviesConnues.has(s.id)) await sonderServi(s, true);
			}
		} else if (modification !== derniereModification) {
			for (const s of await o.etat.lister({ archivees: true })) {
				// archivée jamais montrée et restée telle quelle : l'interface n'en a que faire
				if (!diffusees.has(s.id) && s.etat === 'terminee' && s.majMs <= derniereLecture) continue;
				signaler(s);
				// le journal ne bouge qu'avec un événement : seules les sessions actives ou qui viennent de bouger sont relues
				if (s.etat !== 'terminee' || s.majMs > derniereLecture) await sonderServi(s, false);
			}
		}
		derniereModification = modification;
		derniereLecture = lecture;
		const commit = await stat(journalGit).then(
			(i) => `${i.mtimeMs}:${i.size}`,
			() => '',
		);
		if (dernierCommit !== null && commit !== dernierCommit) diffuser({ type: 'memoire', modifieeMs: Date.now() });
		dernierCommit = commit;
		if (o.versionDesLots !== undefined) {
			const version = await o.versionDesLots();
			if (versionDesLots !== null && version !== versionDesLots) diffuser({ type: 'lots', version });
			versionDesLots = version;
		}
	};
	const sonderUneFois = (): void => {
		if (enCours || ferme) return;
		enCours = true;
		sonder()
			.catch(() => {})
			.finally(() => {
				enCours = false;
			});
	};
	// première lecture tout de suite : elle sert de référence, un changement d'ici la suivante est vu
	sonderUneFois();
	const sondage = setInterval(sonderUneFois, o.sondageMs ?? SONDAGE_MS);

	return {
		accueillir(req, socket, tete) {
			if (ferme) {
				socket.destroy();
				return;
			}
			wss.handleUpgrade(req, socket, tete, (ws) => wss.emit('connection', ws, req));
		},
		diffuser,
		signaler,
		fermer() {
			ferme = true;
			clearInterval(ping);
			clearInterval(sondage);
			for (const c of [...clients]) {
				c.ws.close(1001, 'service arrêté');
				oublier(c);
				// un client qui ne répond pas à la fermeture ne retient pas le service
				setTimeout(() => c.ws.terminate(), 1000).unref();
			}
			wss.close();
		},
	};
}
