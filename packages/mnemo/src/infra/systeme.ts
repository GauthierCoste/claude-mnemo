import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { nodeDurable } from './node-durable.ts';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ulid } from 'ulid';
import type { AppelPlugin } from '../application/plugin.ts';
import type { Dependances, EtatSessions, Index, Lots, Pilotage, Systeme, Terminaux, Verrou } from '../application/ports.ts';
import { ecrirePlugin, retirerPlugin, trouverClaude } from './claude.ts';
import { demarrageMachineMs, etatProcessus, nettoyerRestes } from './processus.ts';
import { terminauxPty } from './terminaux-pty.ts';
import { coffreFichiers } from './coffre-fichiers.ts';
import { extractionIsolee } from './extraction-isolee.ts';
import { fichiersDossier } from './fichiers-dossier.ts';
import { historiqueGit } from './historique-git.ts';
import { rerankerLlama, sensLlama } from './modeles/client-llama.ts';
import { ouvrirEtat, ouvrirLots } from './etat-sqlite.ts';
import { ouvrirIndex } from './index-sqlite.ts';
import { ecrireIndicateur, FICHIER_INDEX, lireIndicateur, marquerIndicateurIllisible } from './indicateur-consignes.ts';
import { depotGit } from './depot-git.ts';
import { pluginsClaude } from './plugins-claude.ts';
import { reglagesDuDossier } from './reglages-fichier.ts';
import { verrouFichier } from './verrou-fichier.ts';
import { versionMnemo } from './version.ts';
import type { ATTENTE_PAR_DEFAUT } from './verrou-fichier.ts';
import { DOSSIER_LOCAL, DOSSIER_MEMOIRE } from '../domaine/dossier-memoire.ts';

export function systemeReel(): Systeme {
	return {
		maintenant: () => new Date(),
		nouvelId: () => ulid(),
		nouvelUuid: () => randomUUID(),
	};
}

/** Droits `mode`, au mieux : un fichier d'un autre utilisateur ou disparu entre-temps ne bloque rien. */
function resserrer(chemin: string, mode: number): void {
	try {
		chmodSync(chemin, mode);
	} catch {
		// pas le propriétaire, ou disparu
	}
}

/**
 * Le seul endroit qui crée `.mnemo/` (état local : index, verrous, modèles) : avec un `.gitignore` qui ignore tout, pour qu'un
 * dépôt qui contient le dossier Mnemo ne le versionne jamais. Un `.mnemo/` plus ancien le reçoit à la prochaine ouverture.
 */
export function preparerDossierLocal(racineDossier: string): string {
	const local = join(racineDossier, DOSSIER_LOCAL);
	// Jeton, état des sessions et journaux : réservés à l'utilisateur.
	mkdirSync(local, { recursive: true, mode: 0o700 });
	// un `.mnemo/` plus ancien, ou créé avec un umask large : droits resserrés à chaque ouverture (sans effet sous Windows)
	resserrer(local, 0o700);
	for (const nom of [FICHIER_INDEX, 'verrou']) {
		const chemin = join(local, nom);
		if (existsSync(chemin)) resserrer(chemin, 0o600);
	}
	const ignore = join(local, '.gitignore');
	if (!existsSync(ignore)) writeFileSync(ignore, '*\n');
	return local;
}

/** Index ouvert au premier usage : les commandes qui ne cherchent pas ne créent ni ne verrouillent rien. */
function indexParesseux(racineDossier: string, options: Parameters<typeof ouvrirIndex>[1]): Index {
	let ouvert: Index | null = null;
	const index = (): Index => {
		if (ouvert === null) {
			ouvert = ouvrirIndex(join(preparerDossierLocal(racineDossier), FICHIER_INDEX), options);
		}
		return ouvert;
	};
	// chaque méthode transmet TOUS ses arguments (options facultatives comprises) à l'index ouvert
	const transmettre = <K extends Exclude<keyof Index, 'fermer'>>(nom: K): Index[K] =>
		((...args: unknown[]) => (index()[nom] as (...a: unknown[]) => unknown)(...args)) as Index[K];
	return {
		fiches: transmettre('fiches'),
		remplacer: transmettre('remplacer'),
		retirer: transmettre('retirer'),
		vider: transmettre('vider'),
		chercher: transmettre('chercher'),
		elements: transmettre('elements'),
		element: transmettre('element'),
		elementsParId: transmettre('elementsParId'),
		liens: transmettre('liens'),
		tousLesLiens: transmettre('tousLesLiens'),
		titres: transmettre('titres'),
		alias: transmettre('alias'),
		sources: transmettre('sources'),
		remplacerPassages: transmettre('remplacerPassages'),
		reserverSources: transmettre('reserverSources'),
		libererSources: transmettre('libererSources'),
		retirerPassages: transmettre('retirerPassages'),
		noterSource: transmettre('noterSource'),
		passage: transmettre('passage'),
		passagesDeSection: transmettre('passagesDeSection'),
		correspondParLeTexte: transmettre('correspondParLeTexte'),
		ancresCommunes: transmettre('ancresCommunes'),
		aVectoriser: transmettre('aVectoriser'),
		nombreAVectoriser: transmettre('nombreAVectoriser'),
		enregistrerVecteurs: transmettre('enregistrerVecteurs'),
		plusProches: transmettre('plusProches'),
		// sans accès disque : un index pas encore ouvert n'a rien en cache (et n'est pas ouvert pour le dire)
		cacheVecteurs: (modele) => (ouvert === null ? 'froid' : ouvert.cacheVecteurs(modele)),
		nombreVecteurs: transmettre('nombreVecteurs'),
		fermer: () => {
			ouvert?.fermer();
			ouvert = null;
		},
	};
}

/** État des sessions (`.mnemo/etat.sqlite`) ouvert au premier usage : `.mnemo/` n'est créé (avec son `.gitignore`) qu'à ce moment. */
export function etatParesseux(racineDossier: string): EtatSessions {
	let ouvert: EtatSessions | null = null;
	const etat = (): EtatSessions => {
		ouvert ??= ouvrirEtat(join(preparerDossierLocal(racineDossier), 'etat.sqlite'));
		return ouvert;
	};
	return {
		creer: (s) => etat().creer(s),
		lire: (id) => etat().lire(id),
		lister: (options) => etat().lister(options),
		appliquer: (id, e, horodatageMs, complement) => etat().appliquer(id, e, horodatageMs, complement),
		modifier: (id, champs) => etat().modifier(id, champs),
		battre: (ids, vuVivantMs) => etat().battre(ids, vuVivantMs),
		journaliser: (entree) => etat().journaliser(entree),
		servis: (session, limite, moment) => etat().servis(session, limite, moment),
		ecarter: (session, ecarte, trace) => etat().ecarter(session, ecarte, trace),
		retablir: (session, id) => etat().retablir(session, id),
		ecartes: (session) => etat().ecartes(session),
		noterFicheServieLueOuEcrite: (session, f) => etat().noterFicheServieLueOuEcrite(session, f),
		fichesServiesLuesOuEcrites: (session) => etat().fichesServiesLuesOuEcrites(session),
		oublierInjections: (session) => etat().oublierInjections(session),
		noterMessagePorteur: (session, texte) => etat().noterMessagePorteur(session, texte),
		noterInjectionManuelle: (session, chemin) => etat().noterInjectionManuelle(session, chemin),
		injectionsManuelles: (session) => etat().injectionsManuelles(session),
		noterCarteProposee: (session, c) => etat().noterCarteProposee(session, c),
		cartesProposees: (session) => etat().cartesProposees(session),
		perimetrePropose: (session) => etat().perimetrePropose(session),
		noterPerimetrePropose: (session, horodatageMs) => etat().noterPerimetrePropose(session, horodatageMs),
		actions: (session) => etat().actions(session),
		sessionsAyantServi: (chemin, limite) => etat().sessionsAyantServi(chemin, limite),
		supprimer: (id) => etat().supprimer(id),
		noterGeste: (geste) => etat().noterGeste(geste),
		gestes: (filtre) => etat().gestes(filtre),
		comptesGestes: () => etat().comptesGestes(),
		derniereModificationMs: () => etat().derniereModificationMs(),
		noterRattachement: (dossier, rattache, vuMs) => etat().noterRattachement(dossier, rattache, vuMs),
		dossiersNonRattaches: () => etat().dossiersNonRattaches(),
		fermer: () => {
			ouvert?.fermer();
			ouvert = null;
		},
	};
}

/** Lots d'informations (`.mnemo/etat.sqlite`) ouverts au premier usage, comme `etatParesseux`. */
export function lotsParesseux(racineDossier: string): Lots {
	let ouverts: Lots | null = null;
	const lots = (): Lots => {
		ouverts ??= ouvrirLots(join(preparerDossierLocal(racineDossier), 'etat.sqlite'));
		return ouverts;
	};
	return {
		enregistrer: (lot) => lots().enregistrer(lot),
		enAttente: () => lots().enAttente(),
		lire: (id) => lots().lire(id),
		decider: (id, decision, decideMs) => lots().decider(id, decision, decideMs),
		decides: (depuisMs, limite) => lots().decides(depuisMs, limite),
		version: () => lots().version(),
		fermer: () => {
			ouverts?.fermer();
			ouverts = null;
		},
	};
}

/** Verrou des écritures de la mémoire, dans `.mnemo/` (préparé au premier usage). */
function verrouLocal(racineDossier: string, attente: Partial<typeof ATTENTE_PAR_DEFAUT> = {}): Verrou {
	const verrou = verrouFichier(join(racineDossier, DOSSIER_LOCAL, 'verrou'), { ...attente, creerDossier: false });
	return {
		avec(action) {
			preparerDossierLocal(racineDossier);
			return verrou.avec(action);
		},
	};
}

/**
 * Câble le coffre : `_mnemo/` pour la mémoire, `.mnemo/` pour l'état local (verrou, index). Appeler `index.fermer()` en fin de
 * commande. `attenteVerrou` : attente du verrou plus courte (un hook a une échéance).
 */
/** `indexEnLecture` : l'index ne s'écrit pas et ses lectures renoncent à `finMs` (hook `outil`, voir `ouvrirIndex`). */
export function dependancesReelles(racineDossier: string, options: { attenteVerrou?: Partial<typeof ATTENTE_PAR_DEFAUT>; indexEnLecture?: { finMs: number } } = {}): Dependances {
	const racineMemoire = join(racineDossier, DOSSIER_MEMOIRE);
	return {
		coffre: coffreFichiers(racineMemoire),
		historique: historiqueGit(racineMemoire),
		verrou: verrouLocal(racineDossier, options.attenteVerrou),
		systeme: systemeReel(),
		index: indexParesseux(racineDossier, options.indexEnLecture === undefined ? {} : { lectureSeule: options.indexEnLecture }),
		documents: fichiersDossier(racineDossier),
		extraction: extractionIsolee(),
		sens: sensLlama(racineDossier),
		reranker: rerankerLlama(racineDossier),
		reglages: reglagesDuDossier(racineDossier),
		pluginsClaude: pluginsClaude(),
		lots: lotsParesseux(racineDossier),
		indicateur: {
			noter: async (presentes, horodatageMs) => ecrireIndicateur(preparerDossierLocal(racineDossier), presentes, horodatageMs),
			marquerIllisible: async (horodatageMs) => marquerIndicateurIllisible(preparerDossierLocal(racineDossier), horodatageMs),
			lire: async () => lireIndicateur(join(racineDossier, DOSSIER_LOCAL)),
		},
	};
}

/** `main.ts` de la CLI : les hooks des plugins l'appellent (`<node> <main.ts> hook <événement>`). */
const MAIN = fileURLToPath(new URL('../adaptateurs/cli/main.ts', import.meta.url));

/** Appel du plugin d'une session : ce Node, `cli/main.ts`, et la version de Mnemo. */
export const appelPlugin = (): AppelPlugin => ({ node: nodeDurable(), main: MAIN, version: versionMnemo() });

/**
 * `relatif` (« / », relatif à `racine`) s'il désigne un dossier existant qui reste sous la racine, liens résolus : son chemin
 * absolu, et son chemin réel relatif à la racine réelle (« / »), que l'application revalide (un lien vers `_mnemo/` est refusé).
 */
async function dossierSousLaRacine(racine: string, relatif: string): Promise<{ absolu: string; reel: string } | null> {
	const absolu = join(racine, ...relatif.split('/').filter((s) => s !== ''));
	try {
		const [reel, racineReelle] = await Promise.all([realpath(absolu), realpath(racine)]);
		const chemin = relative(racineReelle, reel);
		if (chemin === '..' || chemin.startsWith(`..${sep}`) || isAbsolute(chemin)) return null;
		if (!(await stat(reel)).isDirectory()) return null;
		return { absolu, reel: chemin.split(sep).join('/') };
	} catch {
		return null;
	}
}

/**
 * Câble le pilotage du service : état des sessions (`.mnemo/etat.sqlite`, ouvert au premier usage), terminaux node-pty
 * (mode dégradé s'il manque), dépôt git des dossiers de session, plugins dans `.mnemo/plugins/`, hooks appelant ce `main.ts` avec ce Node, `claude` trouvé
 * (`MNEMO_CLAUDE` ou PATH). `env`, `plateforme`, `terminaux` : remplaçables (tests).
 */
export async function pilotageReel(
	racineDossier: string,
	options: { env?: NodeJS.ProcessEnv; plateforme?: NodeJS.Platform; terminaux?: Terminaux } = {},
): Promise<Pilotage> {
	const env = options.env ?? process.env;
	const plateforme = options.plateforme ?? process.platform;
	return {
		etat: etatParesseux(racineDossier),
		depot: depotGit(racineDossier),
		terminaux: options.terminaux ?? (await terminauxPty({ plateforme })),
		plugin: {
			ecrire: (session, fichiers) => ecrirePlugin(racineDossier, session, fichiers),
			retirer: (session) => retirerPlugin(racineDossier, session),
			appel: appelPlugin(),
			claude: trouverClaude(env, plateforme),
			racine: racineDossier,
		},
		hote: {
			env,
			plateforme,
			dossier: (relatif) => dossierSousLaRacine(racineDossier, relatif),
			processus: (pid, session) => etatProcessus(pid, session, plateforme),
			demarrageMachineMs,
			nettoyerRestes: (s) => nettoyerRestes(s, { plateforme }),
		},
	};
}
