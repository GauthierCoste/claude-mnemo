import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { EntreeHook, ReponseHook } from '../../application/evenements.ts';
import { HOOKS_CLAUDE_CODE } from '../../application/moteurs/claude-code/hooks.ts';
import { hooksDuMoteur } from '../../application/moteurs/hooks.ts';
import type { EtatSessions, HooksDuMoteur, LectureHook } from '../../application/ports.ts';
import { estIdMoteur, IDS_MOTEURS, MOTEUR_PAR_DEFAUT } from '../../domaine/moteurs/moteur.ts';
import type { IdMoteur } from '../../domaine/moteurs/moteur.ts';
import type { EvenementHook } from '../../domaine/session.ts';
import { appelerService, lireService, processusVivant } from '../../infra/service-local.ts';
import { trouverRacine } from './racine.ts';
import { DOSSIER_LOCAL, DOSSIER_MEMOIRE } from '../../domaine/dossier-memoire.ts';
import { estObjet } from '../../domaine/valeurs.ts';
import { ENTREE_HOOK_MAX_OCTETS, refusDelai, refusSurErreur, reponseDe, selonIndicateur } from '../../domaine/refus-outil.ts';
import type { EtatIndicateur, RefusNonVerifie } from '../../domaine/refus-outil.ts';
import { lireIndicateur } from '../../infra/indicateur-consignes.ts';
import { cheminReel } from '../../infra/chemin-reel.ts';
import { messageDErreur } from '../../domaine/texte.ts';

/** Échéances des hooks de Claude Code (celles de chaque moteur : `HooksDuMoteur.echeancesMs`). */
export const ECHEANCES_MS: Record<EvenementHook, number> = HOOKS_CLAUDE_CODE.echeancesMs;
/** Délai maximal de la réponse du service ; le calcul local garde au moins `RESERVE_LOCALE_MS` s'il faut s'y replier. */
const DELAI_SERVICE_MS = 300;
const RESERVE_LOCALE_MS = 400;
/** Sous ce délai, appeler le service ne vaut plus la peine : calcul local directement. */
const DELAI_SERVICE_MIN_MS = 50;
/** Contexte rendu par le service : au-delà, la réponse est écartée. */
const CONTEXTE_MAX = 100_000;
/** Attente maximale sur `etat.sqlite` occupé : au-delà, l'état de cet événement est perdu (le suivant le corrige). */
const ATTENTE_ETAT_MS = 150;
/**
 * Épisode minimal sans service (`fin`) : git borné à 600 ms, verrou de la mémoire attendu brièvement (0,4 à 0,8 s, délais
 * tirés au hasard) ; ce qui ne tient pas avant l'échéance est laissé au prochain démarrage du service (session `a_relire`).
 */
const DELAI_GIT_FIN_MS = 600;
const ATTENTE_VERROU_FIN = { essais: 6, delaiMin: 25, facteur: 1.5, delaiMax: 100 };

/** Disques qui ne distinguent pas la casse par défaut : les chemins interdits s'y comparent sans casse. */
const SANS_CASSE = process.platform === 'darwin' || process.platform === 'win32';

/**
 * stdin entier ; au-delà de `ENTREE_HOOK_MAX_OCTETS`, lu jusqu'au bout (l'écriture de Claude Code ne casse pas) puis écarté ;
 * pas fermé avant `delaiMs` (null : sans délai) : `delai_depasse`.
 */
function lireEntree(delaiMs: number | null): Promise<LectureHook> {
	return new Promise((resoudre) => {
		const morceaux: Buffer[] = [];
		let taille = 0;
		let fini = false;
		const terminer = (resultat: LectureHook): void => {
			if (fini) return;
			fini = true;
			clearTimeout(minuteur);
			process.stdin.removeAllListeners('data');
			process.stdin.pause();
			resoudre(resultat);
		};
		const minuteur = delaiMs === null ? undefined : setTimeout(() => terminer({ nonLue: 'delai_depasse' }), Math.max(0, delaiMs));
		process.stdin.on('data', (m: Buffer) => {
			taille += m.byteLength;
			if (taille <= ENTREE_HOOK_MAX_OCTETS) morceaux.push(m);
			else morceaux.length = 0;
		});
		process.stdin.once('end', () => terminer(taille > ENTREE_HOOK_MAX_OCTETS ? { nonLue: 'entree_trop_grosse' } : { texte: Buffer.concat(morceaux).toString('utf8') }));
		process.stdin.once('error', () => terminer({ nonLue: 'erreur_interne' }));
	});
}

/** Dossier Mnemo : `MNEMO_RACINE` (session Mnemo) s'il en est un, sinon en remontant depuis `cwd` (celui de Claude Code). */
function racineDe(cwd: string, env: NodeJS.ProcessEnv): string | null {
	const declaree = env.MNEMO_RACINE;
	if (declaree !== undefined && declaree !== '' && existsSync(join(declaree, DOSSIER_MEMOIRE, 'SCHEMA.md'))) return declaree;
	return trouverRacine(cwd);
}

/**
 * Vérification impossible faute de réponse : décidée par l'indicateur du dossier Mnemo, lu sans l'index (aucun dossier : neuf).
 * `cwd` : celui de l'entrée s'il a été lu, comme pour le calcul ; sinon celui du processus.
 */
function sansReponse(refus: RefusNonVerifie, cwd: string | null): ReponseHook {
	const racine = racineDe(cwd ?? process.cwd(), process.env);
	const indicateur: EtatIndicateur = racine === null ? { genre: 'absent', indexExiste: false } : lireIndicateur(join(racine, DOSSIER_LOCAL));
	return reponseDe(selonIndicateur(refus, indicateur));
}

/** Réponse du service si elle a la forme attendue, sinon null (calcul local). */
function reponseValide(r: unknown): ReponseHook | null {
	if (!estObjet(r)) return null;
	const valide = (v: unknown) => v === undefined || typeof v === 'string';
	if (!valide(r.contexte) || !valide(r.refus) || !valide(r.avis)) return null;
	if (typeof r.contexte === 'string' && r.contexte.length > CONTEXTE_MAX) return null;
	return {
		...(r.contexte === undefined ? {} : { contexte: r.contexte as string }),
		...(r.refus === undefined ? {} : { refus: r.refus as string }),
		...(r.avis === undefined ? {} : { avis: r.avis as string }),
	};
}

/** État qui ne retient rien : `etat.sqlite` n'a pas pu s'ouvrir à temps. */
const ETAT_INERTE: EtatSessions = {
	creer: async () => {},
	lire: async () => null,
	lister: async () => [],
	appliquer: async () => null,
	modifier: async () => null,
	journaliser: async () => {},
	servis: async () => [],
	ecarter: async () => false,
	retablir: async () => false,
	ecartes: async () => [],
	noterFicheServieLueOuEcrite: async () => {},
	fichesServiesLuesOuEcrites: async () => [],
	oublierInjections: async () => {},
	noterMessagePorteur: async () => {},
	noterInjectionManuelle: async () => {},
	injectionsManuelles: async () => [],
	noterCarteProposee: async () => {},
	cartesProposees: async () => new Map(),
	perimetrePropose: async () => null,
	noterPerimetrePropose: async () => {},
	actions: async () => [],
	sessionsAyantServi: async () => ({ sessions: [], total: 0 }),
	supprimer: async () => 'inconnue',
	derniereModificationMs: async () => 0,
	battre: async () => {},
	noterRattachement: async () => {},
	dossiersNonRattaches: async () => [],
	fermer: () => {},
};

/**
 * Sans service : `traiterEvenement` dans ce processus (cache de vecteurs froid : `si-budget`). `etat.sqlite` est ouvert avec une
 * attente bornée ; occupé au-delà, l'événement ne change pas l'état, et la première opération en échec coupe les suivantes.
 */
async function traiterIci(racine: string, entree: EntreeHook, temps: { debutMs: number; echeance: number }): Promise<ReponseHook> {
	const [{ dependancesReelles, preparerDossierLocal }, { ouvrirEtat }, { MARGE_SORTIE_MS, traiterEvenement }, { depotGit }, { dependancesDeSession }] = await Promise.all([
		import('../../infra/systeme.ts'),
		import('../../infra/etat-sqlite.ts'),
		import('../../application/evenements.ts'),
		import('../../infra/depot-git.ts'),
		import('../../application/modeles-de-session.ts'),
	]);
	let etat: EtatSessions = ETAT_INERTE;
	try {
		etat = ouvrirEtat(join(preparerDossierLocal(racine), 'etat.sqlite'), { attenteMaxMs: ATTENTE_ETAT_MS });
	} catch {
		// Occupé ou illisible : servi sans état.
	}
	// `outil` ne synchronise pas : index en lecture seule, dont l'attente d'un verrou s'arrête avant l'échéance (refus)
	const indexEnLecture = entree.evenement === 'outil' ? { indexEnLecture: { finMs: temps.echeance - MARGE_SORTIE_MS } } : {};
	const dep = dependancesReelles(racine, { attenteVerrou: ATTENTE_VERROU_FIN, ...indexEnLecture });
	const depot = depotGit(racine, { delaiMs: DELAI_GIT_FIN_MS });
	const etatDuHook = uneFois(etat);
	// les modèles de la session bornés par son niveau, relu à chaque appel ; ses lectures ont leur propre coupe-circuit : un
	// échec n'arrête qu'elles (la session suit alors la machine), jamais l'état du reste du hook
	const depDuHook = entree.session === '' ? dep : dependancesDeSession(dep, uneFois(etat), entree.session);
	try {
		return await traiterEvenement(depDuHook, { etat: etatDuHook, depot }, entree, { froid: 'si-budget', racine, sansCasse: SANS_CASSE, delaiGitMs: DELAI_GIT_FIN_MS, ...temps });
	} finally {
		// git du dépôt de la session (lecture seule) encore en cours à l'échéance : tué, rien ne survit au hook
		depot.arreter();
		dep.index.fermer();
		etat.fermer();
	}
}

/** Après une première erreur, plus aucune opération sur l'état : l'attente bornée ne se répète pas. */
export function uneFois(etat: EtatSessions): EtatSessions {
	let enPanne = false;
	const garde =
		<A extends unknown[], R>(f: (...a: A) => Promise<R>, repli: R) =>
		async (...a: A): Promise<R> => {
			if (enPanne) return repli;
			try {
				return await f(...a);
			} catch (erreur) {
				enPanne = true;
				throw erreur;
			}
		};
	return {
		...etat,
		lire: garde(etat.lire, null),
		appliquer: garde(etat.appliquer, null),
		ecartes: garde(etat.ecartes, []),
		journaliser: garde(etat.journaliser, undefined),
		noterRattachement: garde(etat.noterRattachement, undefined),
		modifier: garde(etat.modifier, null),
	};
}

/** Écrit la sortie (s'il y en a) puis termine le processus avec le code 0, une fois stdout vidé. */
function terminer(sortie: string): void {
	if (sortie === '') process.exit(0);
	process.stdout.write(sortie, () => process.exit(0));
}

/**
 * `[--moteur <id>]` (une fois, n'importe où ; Claude Code par défaut), puis les arguments de l'événement, lus par les hooks de
 * ce moteur ; `inconnu` : identifiant inconnu (vrai) ou moteur sans implémentation dans cette version (faux).
 */
function lireArguments(args: string[]): { moteur: IdMoteur; hooks: HooksDuMoteur; evenement: EvenementHook; options: Set<string> } | { moteur: string; inconnu: boolean } | null {
	const position = args.indexOf('--moteur');
	let moteur: string = MOTEUR_PAR_DEFAUT;
	let reste = args;
	if (position !== -1) {
		moteur = args[position + 1] ?? '';
		reste = [...args.slice(0, position), ...args.slice(position + 2)];
		if (reste.includes('--moteur')) return null;
	}
	if (!estIdMoteur(moteur)) return { moteur, inconnu: true };
	const hooks = hooksDuMoteur(moteur);
	if (hooks === null) return { moteur, inconnu: false };
	const lu = hooks.lireArguments(reste);
	return lu === null ? null : { moteur, hooks, ...lu };
}

/**
 * `lectureBornee` faux : l'échéance de la lecture est tenue par l'appelant (`reponseAvantEcheance` pour `outil`) ; `lu.cwd` :
 * le `cwd` de l'entrée dès qu'elle est traduite, pour que l'appelant cherche la même racine.
 */
async function reponse(appel: Appel, temps: { debutMs: number; echeance: number }, lectureBornee: boolean, lu: { cwd: string | null }): Promise<ReponseHook> {
	const lecture = await lireEntree(lectureBornee ? temps.echeance - Date.now() : null);
	// horodatage : le démarrage du processus, au plus près de l'instant de l'événement (ordre des hooks rapprochés)
	const traduite = appel.hooks.traduire({ evenement: appel.evenement, options: appel.options, lecture, env: process.env, maintenantMs: temps.debutMs, cwdProcessus: process.cwd(), reel: cheminReel });
	if (traduite === null) return {};
	const { transcription } = traduite;
	const entree: EntreeHook = { ...traduite.entree, moteur: appel.moteur };
	lu.cwd = entree.cwd;
	const racine = racineDe(entree.cwd ?? process.cwd(), process.env);
	if (racine === null) return {};

	const service = lireService(racine);
	const delai = Math.min(DELAI_SERVICE_MS, temps.echeance - Date.now() - RESERVE_LOCALE_MS);
	if (service !== null && delai > DELAI_SERVICE_MIN_MS && processusVivant(service.pid)) {
		// l'instant où l'on cesse d'attendre : au-delà, le service ne note rien de servi (le calcul local servira ces fiches)
		const r = reponseValide(await appelerService(service, '/api/hook', { ...entree, ...(transcription === undefined ? {} : { transcription }), echeanceMs: Date.now() + delai }, delai));
		if (r !== null) return r;
	}
	return traiterIci(racine, entree, temps);
}

/**
 * `outil` doit rendre une décision : une erreur ou l'échéance passée la font décider par l'indicateur (`sansReponse`). Les autres
 * événements vont au bout de leur calcul, déjà borné par l'échéance ; une erreur n'y rend rien.
 */
async function reponseAvantEcheance(appel: Appel, temps: { debutMs: number; echeance: number }): Promise<ReponseHook> {
	const decide = appel.evenement === 'outil';
	const lu: { cwd: string | null } = { cwd: null };
	const calcul = reponse(appel, temps, !decide, lu).catch((erreur: unknown): ReponseHook => {
		process.stderr.write(`mnemo hook : ${messageDErreur(erreur)}\n`);
		return decide ? sansReponse(refusSurErreur(erreur), lu.cwd) : {};
	});
	if (!decide) return calcul;
	let minuteur: ReturnType<typeof setTimeout> | undefined;
	const delai = new Promise<ReponseHook>((resoudre) => {
		minuteur = setTimeout(() => resoudre(sansReponse(refusDelai(), lu.cwd)), Math.max(0, temps.echeance - Date.now()));
	});
	try {
		return await Promise.race([calcul, delai]);
	} finally {
		clearTimeout(minuteur);
	}
}

/** Un appel de `mnemo hook`, lu : le moteur qui l'a lancé (et ses hooks), l'événement Mnemo et ses options. */
type Appel = { moteur: IdMoteur; hooks: HooksDuMoteur; evenement: EvenementHook; options: Set<string> };

/**
 * `mnemo hook <événement> [--notification | --sans-contexte] [--moteur <id>]` : appelé par le moteur de la session (plugin
 * d'une session Mnemo pour Claude Code), entrée JSON sur stdin. Le service d'abord (`POST /api/hook`), sinon le calcul ici.
 * Code 0 ; sur stdout, seulement la réponse JSON attendue par le moteur (`sortie` de ses hooks) ; un refus d'`outil` et un
 * accord non vérifié sont écrits sur stderr, gardés par le moteur dans son journal.
 */
export async function commandeHook(args: string[]): Promise<void> {
	// le démarrage de Node et le chargement des modules comptent dans le budget
	const debutMs = Math.floor(performance.timeOrigin);
	const lu = lireArguments(args);
	if (lu !== null && 'inconnu' in lu) {
		const disponibles = IDS_MOTEURS.filter((id) => hooksDuMoteur(id) !== null).join(', ');
		process.stderr.write(lu.inconnu ? `mnemo hook : moteur inconnu « ${lu.moteur} » (${disponibles}).\n` : `mnemo hook : moteur sans implémentation dans cette version : « ${lu.moteur} » (${disponibles}).\n`);
		terminer('');
		return;
	}
	if (lu === null) {
		process.stderr.write(`mnemo hook : événement ou option inconnus « ${args.join(' ')} » (debut, message, outil, arret, fin ; --notification, --sans-contexte, --moteur).\n`);
		terminer('');
		return;
	}
	const { evenement } = lu;
	const r = await reponseAvantEcheance(lu, { debutMs, echeance: debutMs + lu.hooks.echeancesMs[evenement] });
	const sortie = lu.hooks.sortie(evenement, r);
	if (evenement === 'outil' && sortie !== '') process.stderr.write(`mnemo hook : action refusée : ${r.refus}\n`);
	if (r.avis !== undefined) process.stderr.write(`mnemo hook : ${r.avis}\n`);
	terminer(sortie);
}
