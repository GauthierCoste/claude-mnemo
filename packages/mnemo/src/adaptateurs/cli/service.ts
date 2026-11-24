import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTES } from '@mnemo/contrat';
import { demarrerService, ErreurServiceOccupe } from '../http/serveur.ts';
import type { Service } from '../http/serveur.ts';
import { dossierInterface } from '../http/statique.ts';
import { requeteLocale } from '../../infra/modeles/http-local.ts';
import { lireReglagesDuDossier } from '../../infra/reglages-fichier.ts';
import { lireService, processusVivant, retirerService } from '../../infra/service-local.ts';
import type { ServiceLocal } from '../../infra/service-local.ts';
import { signalerGroupe } from '../../infra/processus.ts';
import { dependancesReelles, pilotageReel } from '../../infra/systeme.ts';
import { adresseAvecJeton, adresseDuService, portDemande, portFixe } from './adresse.ts';
import { ErreurCli } from './erreurs.ts';
import { trouverRacine } from './racine.ts';

/** Attente du service d'un autre `mnemo` qui démarre au même moment (verrou pris, `service.json` pas encore écrit). */
const ATTENTE_AUTRE_SERVICE_MS = 10_000;
/**
 * Arrêt demandé (SIGINT, SIGTERM) : les sessions ont ce délai pour s'arrêter proprement ; au-delà, sortie forcée (journalisée)
 * et les pids restants sont tués à la sortie.
 */
const ARRET_FORCE_SIGNAL_MS = 60_000;
/** Arrêt sur exception : l'état du processus est douteux, délai plus court. */
const ARRET_FORCE_EXCEPTION_MS = 15_000;

/**
 * Les adresses d'un service : la fixe, et celle de première ouverture (avec le jeton) seulement dans un terminal. Sortie
 * redirigée (journal `.mnemo/service.log` d'un service détaché, tube) : jamais le jeton, `mnemo jeton` le donne.
 */
const adresses = (s: Pick<ServiceLocal, 'port' | 'jeton'>): string =>
	`${adresseDuService(s.port)}\nPremière ouverture dans un navigateur : ${process.stdout.isTTY ? adresseAvecJeton(s.port, s.jeton) : '« mnemo jeton » la donne'}`;

/** Le service vivant de ce dossier (`service.json`, processus vivant, `/api/sante` qui répond avec le jeton), ou null. */
export async function serviceVivant(racine: string): Promise<ServiceLocal | null> {
	const s = lireService(racine);
	if (s === null || !processusVivant(s.pid)) return null;
	const r = await requeteLocale(s.port, ROUTES.sante, { cle: s.jeton, finMs: Date.now() + 2000 });
	return r !== null && r.statut === 200 ? s : null;
}

/** Ouvre l'adresse dans le navigateur, sans shell ; un échec est sans conséquence. */
export function ouvrirNavigateur(adresse: string): void {
	const [commande, args] =
		process.platform === 'darwin' ? ['/usr/bin/open', [adresse]] : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', adresse]] : ['xdg-open', [adresse]];
	try {
		const enfant = spawn(commande as string, args as string[], { stdio: 'ignore', detached: true, shell: false });
		enfant.on('error', () => {});
		enfant.unref();
	} catch {
		// pas de navigateur : l'adresse est affichée
	}
}

/** Port fixe occupé par un autre programme. */
function messagePortPris(port: number): string {
	return (
		`Le port ${port} est déjà pris par un autre programme (peut-être Mnemo pour un autre dossier). ` +
		`Libérez-le, ou choisissez un autre port : « service.port » dans .mnemo/reglages.json (par exemple { "service": { "port": 4748 } }), ` +
		`ou pour ce lancement seulement MNEMO_PORT=<port> mnemo — l'adresse de Mnemo change alors ` +
		`(l'application installée et le lanceur suivent l'adresse : recréez-les).`
	);
}

/** Écrit sur stderr sans jamais lever (terminal fermé : EPIPE). */
function ecrireErreur(texte: string): void {
	try {
		process.stderr.write(texte);
	} catch {
		// plus de lecteur : le message est perdu, l'arrêt continue
	}
}

/** Pids des sessions encore tenues à la sortie du processus : tués de façon synchrone (groupe, puis le pid). */
function tuerRestants(service: Service): void {
	for (const pid of service.pids()) signalerGroupe(pid, 'SIGKILL', process.platform);
}

/**
 * `mnemo [dossier]` : le service local du dossier Mnemo (cherché en remontant depuis `dossier`, ou le dossier courant).
 * Déjà vivant : son adresse, et rien d'autre. Sinon il démarre sur le port fixe (réglage `service.port`, 4747 par défaut, ou
 * `MNEMO_PORT` ; pris : erreur
 * lisible, jamais un autre port en silence), relance les sessions, préchauffe, affiche `http://127.0.0.1:<port>/` et l'adresse
 * de première ouverture (`…/#jeton=<jeton>`), ouvre celle-ci dans le navigateur si l'interface est construite
 * (`MNEMO_SANS_NAVIGATEUR=1` : jamais) et tourne jusqu'à SIGINT, SIGTERM, SIGHUP ou `POST /api/arret` : sessions arrêtées
 * (`arreterTout`), `service.json` retiré.
 */
export async function commandeService(dossier: string): Promise<void> {
	const racine = trouverRacine(dossier);
	if (racine === null) throw new ErreurCli(`Aucune mémoire Mnemo trouvée depuis « ${dossier} » ni dans ses dossiers parents. Lancez « mnemo init » pour en créer une.`);
	const { reglages, avertissements } = lireReglagesDuDossier(racine);
	for (const a of avertissements) ecrireErreur(`mnemo : ${a}\n`);
	const port = portDemande(process.env, reglages.service.port);

	const vivant = await serviceVivant(racine);
	if (vivant !== null) {
		console.log(`Mnemo tourne déjà pour ${racine} : ${adresses(vivant)}`);
		return;
	}

	// l'interface construite : `MNEMO_UI_DIST`, sinon `packages/ui/dist` ; le navigateur ne s'ouvre que si elle existe
	const interfaceUi = dossierInterface();
	const dep = dependancesReelles(racine);
	const pil = await pilotageReel(racine);
	const fermer = (): void => {
		dep.index.fermer();
		dep.lots.fermer();
		pil.etat.fermer();
	};
	let service: Service;
	try {
		service = await demarrerService({ racine, dep, pil, interface: interfaceUi, port, ...(portFixe(process.env) ? { portFixePar: 'MNEMO_PORT' } : {}) });
	} catch (erreur) {
		fermer();
		// port fixe déjà pris : jamais un autre port en silence (l'adresse, le favori et le lanceur changeraient)
		if ((erreur as NodeJS.ErrnoException).code === 'EADDRINUSE') throw new ErreurCli(messagePortPris(port));
		if (!(erreur instanceof ErreurServiceOccupe)) throw erreur;
		// un autre `mnemo` démarre en même temps : on attend son adresse
		const fin = Date.now() + ATTENTE_AUTRE_SERVICE_MS;
		while (Date.now() < fin) {
			const autre = await serviceVivant(racine);
			if (autre !== null) {
				console.log(`Mnemo tourne déjà pour ${racine} : ${adresses(autre)}`);
				return;
			}
			await new Promise((r) => setTimeout(r, 200));
		}
		throw new ErreurCli(
			`${erreur.message} Il ne répond pas : s'il n'existe plus, retirez « .mnemo/service.verrou ».`,
		);
	}

	console.log(`Mnemo : ${adresses(service)}`);
	console.log('Ctrl-C pour arrêter le service (les sessions reprendront au prochain démarrage).');
	// avec le jeton : ce navigateur le garde pour cette origine, l'adresse fixe suffira ensuite
	if (process.env.MNEMO_SANS_NAVIGATEUR !== '1' && existsSync(join(interfaceUi, 'index.html'))) ouvrirNavigateur(adresseAvecJeton(service.port, service.jeton));

	// terminal fermé (SIGHUP) : stdout et stderr peuvent ne plus avoir de lecteur ; une écriture en échec (EPIPE) n'est jamais
	// une exception qui ferait passer l'arrêt propre pour un plantage
	for (const flux of [process.stdout, process.stderr]) flux.on('error', () => {});
	// filet : quoi qu'il arrive, aucun processus de session ne survit au service
	process.on('exit', () => {
		tuerRestants(service);
		retirerService(racine, { pid: process.pid, port: service.port, demarre: service.demarre });
	});
	let arret: Promise<void> | null = null;
	const arreter = (code: number, delaiMs: number): void => {
		if (arret !== null) {
			// second signal pendant l'arrêt : sortie immédiate (les pids restants sont tués à la sortie)
			process.exit(code === 0 ? 1 : code);
		}
		setTimeout(() => {
			ecrireErreur(`mnemo service : arrêt non terminé après ${delaiMs / 1000} s, sortie forcée.\n`);
			process.exit(code === 0 ? 1 : code);
		}, delaiMs).unref();
		arret = service
			.arreter()
			.catch((e: unknown) => {
				ecrireErreur(`mnemo service : arrêt incomplet (${e instanceof Error ? e.message : String(e)})\n`);
			})
			.finally(() => {
				fermer();
				process.exit(code);
			});
	};
	// verrou repris par un autre service : celui-ci s'est arrêté de lui-même (journalisé), le processus sort
	void service.perdu.then(() => arreter(1, ARRET_FORCE_EXCEPTION_MS));
	// `mnemo arreter` : le même arrêt que SIGTERM, sur toutes les plateformes
	void service.arretDemande.then(() => arreter(0, ARRET_FORCE_SIGNAL_MS));
	process.on('SIGINT', () => arreter(0, ARRET_FORCE_SIGNAL_MS));
	process.on('SIGTERM', () => arreter(0, ARRET_FORCE_SIGNAL_MS));
	// terminal qui lançait le service fermé : un arrêt demandé, pas un plantage (états gardés, aucun épisode)
	process.on('SIGHUP', () => arreter(0, ARRET_FORCE_SIGNAL_MS));
	process.on('uncaughtException', (e) => {
		ecrireErreur(`mnemo service : erreur inattendue (${e instanceof Error ? e.message : String(e)}), arrêt.\n`);
		arreter(1, ARRET_FORCE_EXCEPTION_MS);
	});
}
