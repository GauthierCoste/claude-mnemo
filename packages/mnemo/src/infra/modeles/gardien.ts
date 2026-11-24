import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { messageDErreur } from '../../domaine/texte.ts';
import { piecesPourPlateforme } from './catalogue.ts';
import { dossierModeles } from './dossier.ts';
import { requeteLocale } from './http-local.ts';
import { etatDesPieces } from './installer.ts';
import { journaliser } from './journal.ts';
import { variable } from '../environnement.ts';
import { lireReglagesDuDossier } from '../reglages-fichier.ts';
import { lireService, processusVivant } from '../service-local.ts';
import {
	AGE_MAX_DEMARRAGE_MS,
	chargementMaxMs,
	cheminsModeles,
	nettoyerLances,
	nettoyerLancesSousVerrou,
	noterLance,
	retirerLances,
	ecrireEtatServeurs,
	lireEtatServeurs,
	pidVivant,
	retirerEtatDuGardien,
	verifierServeur,
	verrouModeles,
} from './serveurs.ts';
import type { EntreeServeur, EtatGardien, EtatServeurs, TypeServeur } from './serveurs.ts';
import { DOSSIER_LOCAL } from '../../domaine/dossier-memoire.ts';

/**
 * Arrêt après ce temps sans requête (date de `.mnemo/modeles.actif`) : le réglage `modeles.inactiviteMinutes`, lu au
 * démarrage du gardien ; `MNEMO_MODELES_INACTIVITE_MS` le remplace (tests).
 */
export function inactiviteDuGardien(racine: string, env: NodeJS.ProcessEnv, avertir: (message: string) => void = () => {}): number {
	if (Number(env['MNEMO_MODELES_INACTIVITE_MS']) > 0) return Number(env['MNEMO_MODELES_INACTIVITE_MS']);
	const { reglages, avertissements } = lireReglagesDuDossier(racine);
	for (const a of avertissements) avertir(a);
	return reglages.modeles.inactiviteMinutes * 60_000;
}
export type DecisionSurInactivite = { arreter: false } | { arreter: true; motif: string };

/** Le service garde les modèles prêts pour chaque hook ; sans service, l'arrêt pour inactivité rend la mémoire vive. */
export function decisionSurInactivite(e: { serviceVivant: boolean; serviceVuVivant: boolean; inactifDepuisMs: number; inactiviteMs: number }): DecisionSurInactivite {
	if (e.serviceVivant) return { arreter: false };
	if (e.serviceVuVivant) return { arreter: true, motif: 'service arrêté' };
	if (e.inactifDepuisMs > e.inactiviteMs) return { arreter: true, motif: `${Math.round(e.inactiviteMs / 1000)} s sans requête` };
	return { arreter: false };
}

/** Intervalle de surveillance (activité, remplacement) ; plus court si l'inactivité tolérée l'est. */
const SURVEILLANCE_MS = 30_000;
/** Attente de l'arrêt d'un serveur (SIGTERM) avant SIGKILL. */
const ARRET_SERVEUR_MS = 3_000;

const ARGUMENTS: Record<TypeServeur, string[]> = {
	sens: ['--embedding', '--pooling', 'cls', '-c', '16384', '-b', '2048', '-ub', '2048', '-np', '8'],
	reranker: ['--reranking', '-c', '8192', '-b', '2048', '-ub', '2048', '-np', '4'],
};

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Port libre sur 127.0.0.1 : attaché au port 0, lu, relâché (le serveur s'y attache aussitôt ; un échec est réessayé une fois). */
function portLibre(): Promise<number> {
	return new Promise((resoudre, rejeter) => {
		const serveur = createServer();
		serveur.once('error', rejeter);
		serveur.listen(0, '127.0.0.1', () => {
			const adresse = serveur.address();
			serveur.close(() => (typeof adresse === 'object' && adresse !== null ? resoudre(adresse.port) : rejeter(new Error('port introuvable'))));
		});
	});
}

/** Environnement minimal des serveurs : PATH, plus `SystemRoot` sous Windows, le dossier du moteur pour ses bibliothèques sous Linux. */
export function environnementServeur(env: NodeJS.ProcessEnv, plateforme: NodeJS.Platform, moteur: string): Record<string, string> {
	const lire = (nom: string) => variable(env, nom, plateforme);
	const sortie: Record<string, string> = {};
	const chemin = lire('PATH');
	if (chemin !== undefined) sortie['PATH'] = chemin;
	if (plateforme === 'win32') {
		const racineSysteme = lire('SystemRoot');
		if (racineSysteme !== undefined) sortie['SystemRoot'] = racineSysteme;
	}
	if (plateforme === 'linux') sortie['LD_LIBRARY_PATH'] = dirname(moteur);
	return sortie;
}

type Serveur = { type: TypeServeur; gguf: string; enfant: ChildProcess; entree: EntreeServeur };

/**
 * Processus détaché (`mnemo modeles garde <racine>`), un par dossier Mnemo : lance un `llama-server` par modèle installé
 * (sens, reranker), écrit `.mnemo/modeles.json`, les arrête tous à l'arrêt du service ou, sans service, après `inactiviteDuGardien` sans requête, si l'un meurt, si un
 * autre gardien le remplace, si `modeles.json` disparaît, ou sur signal ; retire alors `modeles.json` s'il le nomme encore.
 * Un modèle qui ne démarre pas n'empêche pas l'autre de servir. Ne crée jamais de dossier : si `<racine>/.mnemo` a disparu
 * (dossier supprimé ou recloné), il arrête ses serveurs et sort sans rien écrire. `MNEMO_LLAMA_SERVEUR` (tests seulement)
 * remplace le moteur : un script `.mjs`/`.js` est lancé par Node.
 */
export async function garder(racine: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
	const plateforme = process.platform;
	const depuis = new Date().toISOString();
	const inactiviteMs = inactiviteDuGardien(racine, env, (m) => void journaliser(racine, `gardien : ${m}`));
	const chargementMs = chargementMaxMs(env);
	const surveillanceMs =
		Number(env['MNEMO_MODELES_SURVEILLANCE_MS']) > 0
			? Number(env['MNEMO_MODELES_SURVEILLANCE_MS'])
			: Math.max(50, Math.min(SURVEILLANCE_MS, Math.floor(inactiviteMs / 5)));
	/** Pids de tous les serveurs lancés par ce gardien (essais ratés compris), retirés du registre à la sortie. */
	const pidsLances: number[] = [];
	const journal = (message: string) => journaliser(racine, `gardien : ${message}`);
	/** Serveurs lancés, en chargement ou prêts (un par type) : publiés dès leur lancement, arrêtés à la sortie. */
	const serveurs = new Map<TypeServeur, Serveur>();
	/** Tous les processus lancés (essais ratés compris) : tués à la sortie quoi qu'il arrive. */
	const enfants = new Set<ChildProcess>();
	/** Fichiers de clé pas encore retirés (un serveur les lit à son démarrage seulement). */
	const fichiersCle = new Set<string>();
	let phase: EtatGardien = 'demarrage';
	let arret: Promise<never> | null = null;
	let surveillance: ReturnType<typeof setInterval> | undefined;

	/** Écritures de l'état l'une après l'autre, chacune tirée de la carte au moment où elle s'écrit : aucune entrée perdue. */
	let ecritures: Promise<void> = Promise.resolve();
	const publier = (): Promise<void> => {
		const ecrire = () =>
			ecrireEtatServeurs(racine, {
				gardien: { pid: process.pid, depuis, etat: phase },
				...Object.fromEntries([...serveurs.values()].map((s) => [s.type, s.entree])),
			});
		ecritures = ecritures.then(ecrire, ecrire);
		return ecritures;
	};

	/**
	 * Arrête tout, une seule fois, puis termine le processus. En échec (démarrage raté, serveur mort), laisse une trace `echec`
	 * d'une minute : les appels suivants ne relancent pas en boucle.
	 */
	const arreter = (motif: string, echec = false): Promise<never> => {
		arret ??= (async () => {
			try {
				await arreterTout(motif, echec);
			} finally {
				// filet : aucun enfant ne survit au gardien, même si l'arrêt ordonné a échoué
				for (const enfant of enfants) {
					if (enfant.exitCode === null && enfant.signalCode === null) enfant.kill('SIGKILL');
				}
				process.exit(0);
			}
		})();
		return arret;
	};
	const arreterTout = async (motif: string, echec: boolean): Promise<void> => {
		clearInterval(surveillance);
		// dossier supprimé (ou recloné au même chemin) : ses serveurs arrêtés, aucune écriture (rien ne recrée `.mnemo/`)
		if (!existsSync(join(racine, DOSSIER_LOCAL))) {
			await Promise.all([...serveurs.values()].map((s) => arreterServeur(s.enfant)));
			return;
		}
		await journal(`arrêt (${motif})`);
		await Promise.all([...serveurs.values()].map((s) => arreterServeur(s.enfant)));
		await Promise.all([...fichiersCle].map((f) => rm(f, { force: true })));
		await retirerLances(racine, pidsLances).catch(() => {});
		try {
			const etat = await lireEtatServeurs(racine);
			if (echec && etat?.gardien.pid === process.pid) {
				await ecrireEtatServeurs(racine, { gardien: { pid: process.pid, depuis: new Date().toISOString(), etat: 'echec' } });
			} else await retirerEtatDuGardien(racine, process.pid);
		} catch {
			/* rien à retirer */
		}
	};

	for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(signal, () => void arreter(`signal ${signal}`));
	process.on('uncaughtException', (erreur) => void arreter(`erreur : ${messageDErreur(erreur)}`, phase === 'demarrage'));
	process.on('unhandledRejection', (erreur) => void arreter(`erreur : ${messageDErreur(erreur)}`, phase === 'demarrage'));

	try {
		return await demarrerEtGarder();
	} catch (erreur) {
		// filet : toute erreur du démarrage ou de la garde (dossier supprimé pendant un chargement…) arrête tout
		return arreter(`erreur : ${messageDErreur(erreur)}`, phase === 'demarrage');
	}

	async function demarrerEtGarder(): Promise<void> {
		// Les pièces installées.
		const pieces = piecesPourPlateforme(plateforme, process.arch);
		if (pieces === null) return arreter(`plateforme non prise en charge : ${plateforme}-${process.arch}`, true);
		const etats = await etatDesPieces(dossierModeles(env, plateforme, homedir()), pieces);
		const remplacant = env['MNEMO_LLAMA_SERVEUR'];
		const moteurInstalle = etats.find((e) => e.piece.nom === 'moteur' && e.installee)?.chemin;
		const moteur = remplacant !== undefined && remplacant !== '' ? remplacant : moteurInstalle;
		const modeles = etats.filter((e) => e.piece.nom !== 'moteur' && e.installee).map((e) => ({ type: e.piece.nom as TypeServeur, gguf: e.chemin }));
		if (moteur === undefined) return arreter('moteur llama.cpp absent', true);
		if (modeles.length === 0) return arreter('aucun modèle installé', true);

		// Un seul gardien par dossier : sous le verrou, laisser la place à un autre qui démarre ou qui sert déjà.
		const place = await verrouModeles(racine).avec(async () => {
			const ancien = await lireEtatServeurs(racine);
			if (ancien !== null && ancien.gardien.pid !== process.pid) {
				if (await autreGardienActif(ancien)) return false;
			}
			// serveurs d'un gardien disparu, même tué en plein chargement : retrouvés par le registre
			await nettoyerLancesSousVerrou(racine, process.pid, env);
			await publier();
			return true;
		});
		if (!place) {
			await journal('un autre gardien est déjà en marche');
			process.exit(0);
		}

		// Lancement des serveurs.
		const lancer = async (type: TypeServeur, gguf: string, essai: number): Promise<Serveur> => {
			const port = await portLibre().catch(() => portLibre());
			const cle = randomBytes(32).toString('hex');
			// la clé passe par un fichier 0600 (jamais sur la ligne de commande, visible de tous par `ps`), retiré une fois le
			// serveur prêt : llama-server le lit à son démarrage seulement
			const fichierCle = join(racine, DOSSIER_LOCAL, `modeles-${type}-${randomBytes(6).toString('hex')}.cle`);
			await writeFile(fichierCle, `${cle}\n`, { mode: 0o600 });
			await chmod(fichierCle, 0o600);
			fichiersCle.add(fichierCle);
			const oublierCle = async () => {
				fichiersCle.delete(fichierCle);
				await rm(fichierCle, { force: true });
			};
			const args = ['-m', gguf, '--host', '127.0.0.1', '--port', String(port), '--api-key-file', fichierCle, '--log-disable', ...ARGUMENTS[type]];
			const parNode = /\.(mjs|js)$/iu.test(moteur);
			const enfant = spawn(parNode ? process.execPath : moteur, parNode ? [moteur, ...args] : args, {
				env: environnementServeur(env, plateforme, moteur),
				stdio: ['ignore', 'ignore', 'pipe'],
				windowsHide: true,
			});
			enfant.stderr?.setEncoding('utf8');
			enfant.stderr?.on('data', (texte: string) => {
				for (const ligne of texte.split('\n')) if (ligne.trim() !== '') void journaliser(racine, `${type} : ${ligne.slice(0, 500)}`);
			});
			const parti = new Promise<string>((resoudre) => {
				enfant.once('error', (erreur) => resoudre(messageDErreur(erreur)));
				enfant.once('exit', (code, signal) => resoudre(`sorti (${signal ?? code})`));
			});
			const serveur: Serveur = { type, gguf, enfant, entree: { port, cle, modele: basename(gguf), pid: enfant.pid ?? -1, depuis: new Date().toISOString() } };
			// noté aussitôt (registre, puis état) : un gardien tué pendant le chargement laisse de quoi retrouver ce serveur
			enfants.add(enfant);
			if (enfant.pid !== undefined) {
				pidsLances.push(enfant.pid);
				try {
					await noterLance(racine, { pid: enfant.pid, port, cle, piece: basename(gguf), lanceMs: Date.now(), gardien: process.pid });
				} catch (erreur) {
					// pas noté, donc introuvable après nous : arrêté tout de suite
					enfant.kill('SIGKILL');
					throw erreur;
				}
			}
			serveurs.set(type, serveur);
			await publier();
			await journal(`${type} lancé (pid ${serveur.entree.pid}, port ${port}, essai ${essai})`);
			const fin = Date.now() + chargementMs;
			let sortie: string | null = null;
			void parti.then((motif) => (sortie = motif));
			while (sortie === null && Date.now() < fin) {
				const reponse = await requeteLocale(port, '/v1/models', { cle, finMs: Math.min(fin, Date.now() + 1000) });
				if (reponse?.statut === 200 && sortie === null) {
					await oublierCle();
					return serveur;
				}
				await pause(100);
			}
			await oublierCle();
			if (sortie === null) {
				await arreterServeur(enfant);
				serveurs.delete(type);
				throw new Error(`${type} : pas prêt après ${chargementMs / 1000} s`);
			}
			// le port a pu être pris entre-temps : un second essai sur un autre port
			if (essai === 1) {
				await journal(`${type} ${sortie} au démarrage ; nouvel essai`);
				return lancer(type, gguf, 2);
			}
			serveurs.delete(type);
			throw new Error(`${type} ${sortie} au démarrage`);
		};

		// Un modèle qui ne démarre pas n'empêche pas l'autre : celui qui est prêt est publié seul (le client tient le modèle
		// absent de l'état pour indisponible, sans relancer de gardien) ; aucun prêt → échec.
		const prets = await Promise.allSettled(modeles.map(({ type, gguf }) => lancer(type, gguf, 1)));
		const echecs: string[] = [];
		for (const [i, p] of prets.entries()) {
			if (p.status === 'fulfilled') continue;
			const type = modeles[i]!.type;
			const reste = serveurs.get(type);
			if (reste !== undefined) {
				await arreterServeur(reste.enfant);
				serveurs.delete(type);
			}
			echecs.push(messageDErreur(p.reason));
		}
		if (serveurs.size === 0) return arreter(echecs.join(' ; ') || 'aucun serveur prêt', true);
		for (const motif of echecs) await journal(`${motif} ; les autres modèles servent sans lui`);
		phase = 'pret';
		try {
			await publier();
		} catch (erreur) {
			return arreter(`publication impossible : ${messageDErreur(erreur)}`);
		}
		await journal(`prêt : ${[...serveurs.values()].map((s) => `${s.type} port ${s.entree.port}`).join(', ')}`);

		// un serveur mort après « prêt » laisse la même trace `echec` d'une minute : pas de relance en boucle
		for (const s of serveurs.values()) s.enfant.once('exit', (code, signal) => void arreter(`${s.type} arrêté (${signal ?? code})`, true));
		const mort = [...serveurs.values()].find((s) => s.enfant.exitCode !== null || s.enfant.signalCode !== null);
		if (mort !== undefined) return arreter(`${mort.type} arrêté`, true);

		// Surveillance : inactivité, remplacement par un autre gardien, état ou dossier disparu.
		const debut = Date.now();
		let serviceVuVivant = false;
		let verification = false;
		surveillance = setInterval(
			() => {
				if (verification) return; // la précédente n'a pas fini
				verification = true;
				void (async () => {
					const etat = await lireEtatServeurs(racine);
					// `.mnemo/` supprimé : `arreter` le voit et sort sans rien écrire
					if (etat === null) return arreter('état disparu');
					if (etat.gardien.pid !== process.pid) return arreter('remplacé par un autre gardien');
					let derniere = debut;
					try {
						derniere = Math.max(debut, (await stat(cheminsModeles(racine).actif)).mtimeMs);
					} catch {
						/* aucune requête encore */
					}
					const service = lireService(racine);
					const serviceVivant = service !== null && processusVivant(service.pid);
					const decision = decisionSurInactivite({ serviceVivant, serviceVuVivant, inactifDepuisMs: Date.now() - derniere, inactiviteMs });
					if (serviceVivant) serviceVuVivant = true;
					if (decision.arreter) return arreter(decision.motif);
					// serveurs d'un gardien disparu qui chargeaient encore au démarrage : arrêtés dès qu'ils répondent
					await nettoyerLances(racine, { garder: process.pid, env });
				})().finally(() => {
					verification = false;
				});
			},
			surveillanceMs,
		);
		return new Promise<void>(() => {});
	}
}

/** Un autre gardien vivant qui démarre (depuis peu) ou dont un serveur répond : il garde sa place. */
async function autreGardienActif(etat: EtatServeurs): Promise<boolean> {
	if (!pidVivant(etat.gardien.pid)) return false;
	if (etat.gardien.etat === 'demarrage') return Date.now() - (Date.parse(etat.gardien.depuis) || 0) < AGE_MAX_DEMARRAGE_MS;
	for (const entree of [etat.sens, etat.reranker]) {
		if (entree !== undefined && (await verifierServeur(entree, Date.now() + 1000))) return true;
	}
	return false;
}

async function arreterServeur(enfant: ChildProcess): Promise<void> {
	if (enfant.exitCode !== null || enfant.signalCode !== null) return;
	const fini = new Promise<void>((r) => enfant.once('exit', () => r()));
	enfant.kill('SIGTERM');
	const termine = await Promise.race([fini.then(() => true), pause(ARRET_SERVEUR_MS).then(() => false)]);
	if (!termine) {
		enfant.kill('SIGKILL');
		await Promise.race([fini, pause(1000)]);
	}
}
