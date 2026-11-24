import { spawn } from 'node:child_process';
import { chmodSync, closeSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Navigateur } from '../../domaine/reglages.ts';
import { commandeFenetre, nomDuNavigateur, posteCourant } from '../../infra/navigateurs.ts';
import { lireReglagesDuDossier } from '../../infra/reglages-fichier.ts';
import type { ServiceLocal } from '../../infra/service-local.ts';
import { preparerDossierLocal } from '../../infra/systeme.ts';
import { adresseDuService } from './adresse.ts';
import { AUCUNE_MEMOIRE, ErreurCli } from './erreurs.ts';
import { trouverRacine } from './racine.ts';
import { ouvrirNavigateur, serviceVivant } from './service.ts';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));
/** Démarrage du service (index, état, relance des sessions) : au-delà, on renvoie au journal. */
const ATTENTE_DEMARRAGE_MS = 30_000;
/** Lignes du journal recopiées dans l'erreur quand le service ne démarre pas. */
const LIGNES_JOURNAL = 5;

/** Ouvre l'adresse avec le navigateur réglé (en fenêtre d'application s'il le sait), sinon dans le navigateur par défaut. */
function ouvrirFenetre(adresse: string, navigateur: Navigateur): void {
	const c = commandeFenetre(navigateur, adresse, posteCourant());
	if (c === null) {
		if (navigateur !== 'auto' && navigateur !== 'defaut') console.log(`${nomDuNavigateur(navigateur)} introuvable sur ce poste : navigateur par défaut (réglage « service.navigateur »).`);
		return ouvrirNavigateur(adresse);
	}
	const enfant = spawn(c.commande, c.args, { stdio: 'ignore', detached: true, shell: false });
	enfant.on('error', () => {});
	enfant.unref();
}

/** Dernières lignes du journal, pour l'erreur. */
function finDuJournal(journal: string): string {
	try {
		return readFileSync(journal, 'utf8').trimEnd().split('\n').slice(-LIGNES_JOURNAL).join('\n');
	} catch {
		return '';
	}
}

/** Démarre le service du dossier, détaché (sans terminal), sortie dans `.mnemo/service.log` (0600) ; attend qu'il réponde. */
async function demarrerDetache(racine: string): Promise<ServiceLocal> {
	const journal = join(preparerDossierLocal(racine), 'service.log');
	const fd = openSync(journal, 'a', 0o600);
	let sorti: number | null = null;
	try {
		chmodSync(journal, 0o600);
		// le navigateur est ouvert par `ouvrir`, sur l'adresse sans jeton : le service n'en ouvre pas
		const enfant = spawn(process.execPath, [MAIN, racine], {
			cwd: racine,
			detached: true,
			stdio: ['ignore', fd, fd],
			env: { ...process.env, MNEMO_SANS_NAVIGATEUR: '1' },
			shell: false,
			windowsHide: true,
		});
		enfant.on('exit', (code) => {
			sorti = code ?? 1;
		});
		enfant.unref();
	} finally {
		closeSync(fd);
	}
	const fin = Date.now() + ATTENTE_DEMARRAGE_MS;
	while (Date.now() < fin) {
		const vivant = await serviceVivant(racine);
		if (vivant !== null) return vivant;
		if (sorti !== null) break;
		await new Promise((r) => setTimeout(r, 200));
	}
	// un autre `mnemo` a pu le démarrer entre-temps
	const autre = await serviceVivant(racine);
	if (autre !== null) return autre;
	const dernieres = finDuJournal(journal);
	throw new ErreurCli(`Le service Mnemo n'a pas démarré (voir ${journal})${dernieres === '' ? '.' : ` :\n${dernieres}`}`);
}

/**
 * `mnemo ouvrir [dossier]` (appelé par le lanceur macOS) : démarre le service du dossier s'il ne tourne pas, détaché, puis
 * ouvre `http://127.0.0.1:<port>/` avec le navigateur réglé (`service.navigateur`), en fenêtre d'application. L'adresse ouverte ne porte jamais le jeton (elle resterait
 * lisible dans la ligne de commande du navigateur) : un navigateur pas encore reconnu affiche l'écran du jeton.
 * `MNEMO_SANS_NAVIGATEUR=1` : rien n'est ouvert, l'adresse est seulement affichée.
 */
export async function commandeOuvrir(args: string[]): Promise<void> {
	if (args.length > 1 || args.some((a) => a.startsWith('-'))) throw new ErreurCli('Usage : mnemo ouvrir [dossier]', 2);
	const depuis = args[0] ?? process.cwd();
	const racine = trouverRacine(depuis);
	if (racine === null) throw new ErreurCli(args[0] === undefined ? AUCUNE_MEMOIRE : `Aucune mémoire Mnemo trouvée depuis « ${depuis} ».`);
	const deja = await serviceVivant(racine);
	const service = deja ?? (await demarrerDetache(racine));
	const adresse = adresseDuService(service.port);
	console.log(`${deja === null ? 'Mnemo démarré' : 'Mnemo tourne déjà'} pour ${racine} : ${adresse}`);
	if (process.env.MNEMO_SANS_NAVIGATEUR !== '1') ouvrirFenetre(adresse, lireReglagesDuDossier(racine).reglages.service.navigateur);
}
