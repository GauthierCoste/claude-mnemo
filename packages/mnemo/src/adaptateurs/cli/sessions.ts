import { ROUTES } from '@mnemo/contrat';
import type { MessageClient, MessageServeur, SessionVue } from '@mnemo/contrat';
import { requeteLocale } from '../../infra/modeles/http-local.ts';
import type { ServiceLocal } from '../../infra/service-local.ts';
import { AUCUNE_MEMOIRE, ErreurCli } from './erreurs.ts';
import { trouverRacine } from './racine.ts';
import { serviceVivant } from './service.ts';

const USAGE = `Usage :
  mnemo sessions                                              sessions en cours
  mnemo session lancer <dossier> [--profil p] [--objectif t]  lance une session (dossier relatif à la racine)
  mnemo session terminer <id> [--sans-bilan]                  bilan (l'agent écrit l'épisode), ou abandon
  mnemo session voir <id>                                     terminal de la session (Ctrl-] pour quitter)
<id> : l'identifiant de la session, ou son début (8 caractères suffisent).`;

/** Délai d'une requête au service ; un bilan peut attendre la reprise de la session (30 s). */
const DELAI_MS = 10_000;
const DELAI_BILAN_MS = 60_000;
/** Ctrl-] : quitte `session voir` (comme telnet). */
const QUITTER = '\u001d';

async function service(): Promise<ServiceLocal> {
	const racine = trouverRacine(process.cwd());
	if (racine === null) throw new ErreurCli(AUCUNE_MEMOIRE);
	const s = await serviceVivant(racine);
	if (s === null) throw new ErreurCli('Aucun service Mnemo ne tourne pour ce dossier : lancez « mnemo » d’abord.');
	return s;
}

/** Requête au service : le corps JSON d'une réponse 2xx ; sinon l'erreur rendue (`{ erreur }`). */
async function appeler<T>(s: ServiceLocal, chemin: string, corps?: unknown, delaiMs = DELAI_MS): Promise<T> {
	const r = await requeteLocale(s.port, chemin, { cle: s.jeton, finMs: Date.now() + delaiMs, ...(corps === undefined ? {} : { corps }) });
	if (r === null) throw new ErreurCli('Le service Mnemo ne répond pas.');
	if (r.statut < 200 || r.statut >= 300) {
		const erreur = (r.corps as { erreur?: unknown } | undefined)?.erreur;
		throw new ErreurCli(typeof erreur === 'string' ? erreur : `Le service a répondu ${r.statut}.`);
	}
	return r.corps as T;
}

const ligne = (s: SessionVue): string =>
	`${s.id}  ${s.etat.padEnd(9)}  ${s.profil.padEnd(10)}  ${(s.dossier === '' ? '.' : s.dossier).padEnd(20)}  ${s.objectif ?? ''}${s.terminal ? '' : '  (sans terminal)'}`;

/** Session désignée par son id ou son début (unique) parmi celles du service, terminées comprises. */
async function trouverSession(s: ServiceLocal, debut: string | undefined): Promise<SessionVue> {
	if (debut === undefined || debut === '') throw new ErreurCli(USAGE, 2);
	const { sessions } = await appeler<{ sessions: SessionVue[] }>(s, `${ROUTES.sessions}?archivees=1`);
	const trouvees = sessions.filter((x) => x.id.startsWith(debut.toLowerCase()));
	if (trouvees.length === 0) throw new ErreurCli(`Aucune session « ${debut} ».`);
	if (trouvees.length > 1) throw new ErreurCli(`« ${debut} » désigne plusieurs sessions : donnez plus de caractères.`);
	return trouvees[0]!;
}

/** `mnemo sessions` : les sessions en cours du service de ce dossier. */
export async function commandeSessions(args: string[]): Promise<void> {
	if (args.length > 0) throw new ErreurCli(USAGE, 2);
	const s = await service();
	const { sessions } = await appeler<{ sessions: SessionVue[] }>(s, ROUTES.sessions);
	console.log(sessions.length === 0 ? 'Aucune session en cours.' : sessions.map(ligne).join('\n'));
}

/** `mnemo session lancer|terminer|voir` : piloter les sessions sans l'interface. */
export async function commandeSession(args: string[]): Promise<void> {
	const [action, ...reste] = args;
	switch (action) {
		case 'lancer':
			return lancer(reste);
		case 'terminer':
			return terminer(reste);
		case 'voir':
			return voir(reste);
		default:
			throw new ErreurCli(USAGE, 2);
	}
}

async function lancer(args: string[]): Promise<void> {
	let dossier: string | undefined;
	let profil: string | undefined;
	let objectif: string | undefined;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]!;
		if (arg === '--profil' || arg === '--objectif') {
			const valeur = args[++i];
			if (valeur === undefined) throw new ErreurCli(USAGE, 2);
			if (arg === '--profil') profil = valeur;
			else objectif = valeur;
		} else if (arg.startsWith('--')) throw new ErreurCli(`Option inconnue : « ${arg} ».\n${USAGE}`, 2);
		else if (dossier === undefined) dossier = arg;
		else throw new ErreurCli(USAGE, 2);
	}
	if (dossier === undefined) throw new ErreurCli(USAGE, 2);
	const s = await service();
	const r = await appeler<{ session: SessionVue; manuel?: string }>(s, ROUTES.sessions, {
		dossier,
		...(profil === undefined ? {} : { profil }),
		...(objectif === undefined ? {} : { objectif }),
	});
	console.log(ligne(r.session));
	if (r.manuel !== undefined) console.log(`Pas de terminal dans Mnemo : lancez cette commande dans votre terminal :\n${r.manuel}`);
}

async function terminer(args: string[]): Promise<void> {
	const sansBilan = args.includes('--sans-bilan');
	const autres = args.filter((a) => a !== '--sans-bilan');
	if (autres.length !== 1 || autres[0]!.startsWith('--')) throw new ErreurCli(USAGE, 2);
	const s = await service();
	const session = await trouverSession(s, autres[0]);
	if (session.etat === 'terminee') throw new ErreurCli('Session déjà terminée.');
	const route = (sansBilan ? ROUTES.abandon : ROUTES.bilan).replace(':id', session.id);
	const r = await appeler<{ session: SessionVue }>(s, route, {}, DELAI_BILAN_MS);
	console.log(ligne(r.session));
	if (!sansBilan && r.session.etat !== 'terminee') console.log('Bilan demandé : l’agent écrit l’épisode, puis la session s’arrête.');
}

/** Terminal de la session dans ce terminal (mode brut), par le WebSocket du service ; Ctrl-] quitte. */
async function voir(args: string[]): Promise<void> {
	if (args.length !== 1) throw new ErreurCli(USAGE, 2);
	if (!process.stdin.isTTY || !process.stdout.isTTY) throw new ErreurCli('mnemo session voir demande un terminal.');
	const s = await service();
	const session = await trouverSession(s, args[0]);
	if (!session.terminal) throw new ErreurCli(`La session ${session.id} n'a pas de terminal dans le service (état : ${session.etat}).`);
	const { WebSocket } = await import('ws');
	const ws = new WebSocket(`ws://127.0.0.1:${s.port}${ROUTES.ws}?jeton=${s.jeton}`);
	const envoyer = (m: MessageClient): void => {
		if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
	};
	const taille = (): void => envoyer({ type: 'taille', session: session.id, colonnes: process.stdout.columns, lignes: process.stdout.rows });
	await new Promise<void>((resoudre, rejeter) => {
		const quitter = (): void => {
			process.stdin.setRawMode(false);
			process.stdin.pause();
			process.stdout.off('resize', taille);
			ws.close();
			resoudre();
		};
		ws.once('error', (e) => rejeter(new ErreurCli(`Connexion au service impossible : ${e.message}`)));
		ws.once('open', () => {
			envoyer({ type: 'abonner', session: session.id });
			taille();
			process.stdin.setRawMode(true);
			process.stdin.resume();
			process.stdin.on('data', (d: Buffer) => {
				const texte = d.toString('utf8');
				const coupe = texte.indexOf(QUITTER);
				if (coupe >= 0) {
					if (coupe > 0) envoyer({ type: 'entree', session: session.id, donnees: texte.slice(0, coupe) });
					quitter();
					return;
				}
				envoyer({ type: 'entree', session: session.id, donnees: texte });
			});
			process.stdout.on('resize', taille);
		});
		ws.on('message', (brut) => {
			let m: MessageServeur;
			try {
				m = JSON.parse(String(brut)) as MessageServeur;
			} catch {
				return;
			}
			if ((m.type === 'relecture' || m.type === 'sortie') && m.session === session.id) process.stdout.write(m.donnees);
			if (m.type === 'session' && m.session.id === session.id && !m.session.terminal) {
				process.stdout.write('\r\n[Mnemo] La session ne tourne plus dans le service.\r\n');
				quitter();
			}
		});
		ws.once('close', () => {
			if (process.stdin.isRaw) quitter();
		});
	});
	process.stdout.write('\r\n');
}
