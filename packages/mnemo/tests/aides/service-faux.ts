import { request } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import type { ArretModeles, EtatModeles, EtatSessions, Modeles, Pilotage } from '../../src/application/ports.ts';
import { demarrerService } from '../../src/adaptateurs/http/serveur.ts';
import type { ReglagesService, Service } from '../../src/adaptateurs/http/serveur.ts';
import type { AppClaude } from '../../src/adaptateurs/http/claude-desktop.ts';
import { retirerPlugin } from '../../src/infra/plugin-fichiers.ts';
import { moteursDeTest } from './moteurs.ts';
import { ouvrirEtat } from '../../src/infra/etat-sqlite.ts';
import { preparerDossierLocal } from '../../src/infra/systeme.ts';
import { dossierTemporaire } from './dossier-temporaire.ts';
import { DEPOT_ABSENT, fauxPorts } from './faux-ports.ts';
import { fauxTerminaux } from './faux-terminaux.ts';
import type { FauxTerminaux } from './faux-terminaux.ts';

const services: Service[] = [];
const etats: EtatSessions[] = [];
afterEach(async () => {
	while (services.length > 0) await services.pop()!.arreter().catch(() => {});
	while (etats.length > 0) etats.pop()!.fermer();
});

export type ContexteService = {
	service: Service;
	racine: string;
	dep: ReturnType<typeof fauxPorts>;
	pil: Pilotage;
	etat: EtatSessions;
	terminaux: FauxTerminaux;
	/** Dossiers de session qui existent (relatifs à la racine). */
	existants: Set<string>;
	/** Lignes du journal du service (jamais sur stderr), sauf si le test passe son propre `journal`. */
	journal: string[];
	/**
	 * Faux modèles (jamais de vrai llama-server) : `vue` réglable, gestes notés (`gestes`), `signaler()` appelle les rappels
	 * de la surveillance, `surveillances` : celles en cours.
	 */
	modeles: Modeles & { vue: EtatModeles; arret: ArretModeles; arretNiveau: ArretModeles | null; gestes: string[]; signaler(): void; surveillances: number };
};


/** État des modèles d'un faux service : installés, complets, arrêtés, rien en cours. */
export function etatModelesFaux(): EtatModeles {
	const piece = (modele: string) => ({ modele, editeur: 'BAAI', quantification: 'Q8_0', octets: 635_000_000, empreinte: 'aa473d51' });
	return {
		installes: true,
		niveau: 'complets',
		gardien: 'arrete',
		inactiviteMinutes: null,
		sens: 'arrete',
		reranker: 'arrete',
		pieces: { sens: piece('bge-m3'), reranker: piece('bge-reranker-v2-m3'), moteur: { version: 'b11671', plateforme: 'macOS arm64' } },
		activites: [],
	};
}

/**
 * Service démarré sur un faux pilotage : mémoire en mémoire (`fauxPorts`), état réel dans un dossier temporaire, terminaux
 * simulés (rien n'est lancé), `claude` fictif. Arrêté après chaque test.
 */
export async function serviceFaux(
	reglages: ReglagesService = {},
	options: { pil?: (pil: Pilotage) => void; avant?: (etat: EtatSessions, racine: string) => Promise<void>; interface?: string; dossierClaude?: string; portFixePar?: string; appClaude?: Partial<Omit<AppClaude, 'racine'>> } = {},
): Promise<ContexteService> {
	const racine = await dossierTemporaire();
	const dep = fauxPorts();
	await dep.coffre.ecrire('projets/alpha/alpha.md', `---\nid: 01ABC\ntype: dossier\nportee: projet:alpha\nupdated: 2026-11-01\n---\n# Alpha\n`);
	const etat = ouvrirEtat(join(preparerDossierLocal(racine), 'etat.sqlite'));
	etats.push(etat);
	const terminaux = fauxTerminaux();
	const existants = new Set(['', 'alpha', '_mnemo']);
	const pil: Pilotage = {
		etat,
		terminaux,
		depot: DEPOT_ABSENT,
		plugin: {
			ecrire: async (session) => join(racine, '.mnemo', 'plugins', session),
			retirer: (session) => retirerPlugin(racine, session),
			appel: { node: process.execPath, main: '/opt/mnemo/main.ts', version: '0.0.0-essai' },
			racine,
		},
		moteurs: moteursDeTest({ commande: process.execPath, avant: ['/aides/faux-claude.mjs'] }),
		hote: {
			env: { PATH: '/bin' },
			plateforme: process.platform,
			dossier: async (relatif) => (existants.has(relatif) ? { absolu: join(racine, relatif), reel: relatif } : null),
			processus: async () => 'mort',
			demarrageMachineMs: () => 1_700_000_000_000,
			nettoyerRestes: async () => {},
		},
	};
	options.pil?.(pil);
	await options.avant?.(etat, racine);
	for (const d of existants) await mkdir(join(racine, d), { recursive: true });
	// interface : un dossier absent par défaut (les tests ne dépendent pas de `packages/ui/dist`)
	// configuration de Claude Code : jamais la vraie (~/.claude) ; un dossier absent par défaut
	const dossierClaude = options.dossierClaude ?? join(racine, 'configuration-claude-absente');
	const rappels = new Set<() => void>();
	const modeles: ContexteService['modeles'] = {
		vue: etatModelesFaux(),
		arret: 'arrete',
		arretNiveau: null,
		gestes: [],
		surveillances: 0,
		async etat() {
			return structuredClone(modeles.vue);
		},
		async demarrer() {
			modeles.gestes.push('demarrer');
		},
		async arreter() {
			modeles.gestes.push('arreter');
			return modeles.arret;
		},
		async changerNiveau(niveau) {
			modeles.gestes.push(`niveau ${niveau}`);
			modeles.vue = { ...modeles.vue, niveau };
			return modeles.arretNiveau;
		},
		surveiller(rappel) {
			rappels.add(rappel);
			modeles.surveillances = rappels.size;
			return () => {
				rappels.delete(rappel);
				modeles.surveillances = rappels.size;
			};
		},
		signaler() {
			for (const r of rappels) r();
		},
	};
	const journal: string[] = [];
	// app Claude : jamais le vrai fichier ; un dossier absent par défaut (app non installée), faux Node et faux main.ts
	const appClaude = { fichier: join(racine, 'app-claude-absente', 'claude_desktop_config.json'), maison: racine, node: '/opt/node/bin/node', main: '/opt/mnemo/main.ts', ...options.appClaude };
	const service = await demarrerService({ racine, dep, pil, reglages: { journal: (m) => journal.push(m), ...reglages }, interface: options.interface ?? join(racine, 'interface-absente'), dossierClaude, modeles, appClaude, ...(options.portFixePar === undefined ? {} : { portFixePar: options.portFixePar }) });
	services.push(service);
	// relance du démarrage faite : les sessions créées ensuite par le test ne sont pas relancées par elle
	await service.pret;
	return { service, racine, dep, pil, etat, terminaux, existants, journal, modeles };
}

export type Reponse = { statut: number; entetes: Record<string, string | string[] | undefined>; texte: string; corps: unknown };

/**
 * Requête HTTP brute vers 127.0.0.1:<port> (en-tête `Host` choisi, jeton en `Authorization: Bearer`). `corps` : objet (JSON),
 * octets (bruts) ou absent. Rend le statut, les en-têtes et le corps (JSON lu si possible).
 */
export function appeler(
	port: number,
	methode: string,
	chemin: string,
	options: { jeton?: string | null; corps?: unknown; host?: string; entetes?: Record<string, string>; hote?: string } = {},
): Promise<Reponse> {
	return new Promise((resoudre, rejeter) => {
		const brut = options.corps === undefined ? undefined : options.corps instanceof Uint8Array ? Buffer.from(options.corps) : Buffer.from(JSON.stringify(options.corps));
		const req = request(
			{
				host: options.hote ?? '127.0.0.1',
				port,
				path: chemin,
				method: methode,
				agent: false,
				// une en-tête de valeur « » est omise (`content-length: ''` : corps envoyé en morceaux par Node)
				headers: Object.fromEntries(
					Object.entries({
						host: options.host ?? `127.0.0.1:${port}`,
						...(options.jeton ? { authorization: `Bearer ${options.jeton}` } : {}),
						...(brut === undefined ? {} : { 'content-type': options.corps instanceof Uint8Array ? 'application/octet-stream' : 'application/json', 'content-length': String(brut.byteLength) }),
						...options.entetes,
					}).filter(([, v]) => v !== ''),
				),
			},
			(res) => {
				const morceaux: Buffer[] = [];
				res.on('data', (m: Buffer) => morceaux.push(m));
				res.on('end', () => {
					const texte = Buffer.concat(morceaux).toString('utf8');
					let corps: unknown;
					try {
						corps = JSON.parse(texte);
					} catch {
						corps = undefined;
					}
					resoudre({ statut: res.statusCode ?? 0, entetes: res.headers, texte, corps });
				});
				res.on('error', rejeter);
			},
		);
		req.on('error', rejeter);
		if (brut === undefined) req.end();
		else {
			// en deux écritures : sans longueur annoncée, le corps part en morceaux
			req.write(brut.subarray(0, 1));
			req.end(brut.subarray(1));
		}
	});
}

/** Attend qu'une condition soit vraie (sondée toutes les 20 ms) ; faux après `delaiMs`. */
export async function jusqua(condition: () => boolean | Promise<boolean>, delaiMs: number): Promise<boolean> {
	const fin = Date.now() + delaiMs;
	while (Date.now() < fin) {
		if (await condition()) return true;
		await new Promise((r) => setTimeout(r, 20));
	}
	return condition();
}
