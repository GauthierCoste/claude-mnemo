import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { EntreeHook, ReponseHook } from '../../application/evenements.ts';
import type { EtatSessions } from '../../application/ports.ts';
import { estSourceDeDebut, estUuid } from '../../domaine/session.ts';
import type { EvenementHook } from '../../domaine/session.ts';
import { appelerService, lireService, processusVivant } from '../../infra/service-local.ts';
import { trouverRacine } from './racine.ts';
import { DOSSIER_LOCAL, DOSSIER_MEMOIRE } from '../../domaine/dossier-memoire.ts';
import { estObjet } from '../../domaine/valeurs.ts';
import { ENTREE_HOOK_MAX_OCTETS, refusDelai, refusSurErreur, reponseDe, selonIndicateur } from '../../domaine/refus-outil.ts';
import type { CauseNonVerifiee, EtatIndicateur, RefusNonVerifie } from '../../domaine/refus-outil.ts';
import { lireIndicateur } from '../../infra/indicateur-consignes.ts';
import { cheminReel } from '../../infra/chemin-reel.ts';
import { messageDErreur } from '../../domaine/texte.ts';

/** Événement Mnemo de l'argument : nom Mnemo (celui du plugin assemblé) ou nom Claude Code. */
const EVENEMENTS: Record<string, EvenementHook> = {
	debut: 'debut',
	message: 'message',
	outil: 'outil',
	apres_outil: 'apres_outil',
	arret: 'arret',
	fin: 'fin',
	SessionStart: 'debut',
	UserPromptSubmit: 'message',
	PreToolUse: 'outil',
	PostToolUse: 'apres_outil',
	Stop: 'arret',
	Notification: 'arret',
	SessionEnd: 'fin',
};
/** Options permises après l'événement (celles du plugin assemblé), une fois chacune. */
const OPTIONS: Partial<Record<EvenementHook, readonly string[]>> = { arret: ['--notification'], debut: ['--sans-contexte'], message: ['--sans-contexte'], apres_outil: ['--sans-contexte'] };
/**
 * Notifications qui ne montrent aucun dialogue : `idle_prompt` (Claude attend un message depuis un moment, après un `Stop`)
 * compte comme un `Stop`. Les autres (`permission_prompt`, `elicitation_dialog`, type absent…) : un dialogue peut être ouvert.
 */
const NOTIFICATIONS_SANS_DIALOGUE = new Set(['idle_prompt']);

/** Nom Claude Code de la sortie, pour les événements qui ajoutent un contexte. */
const SORTIES: Partial<Record<EvenementHook, string>> = { debut: 'SessionStart', message: 'UserPromptSubmit', apres_outil: 'PostToolUse' };

/**
 * Échéance de chaque événement depuis le démarrage du processus : lecture de stdin, service, état et `servir` s'y bornent. `fin` :
 * sous les 1,5 s que Claude Code laisse à `SessionEnd` ; `outil` : 1 s de marge avant les 3 s du `timeout` du plugin.
 */
export const ECHEANCES_MS: Record<EvenementHook, number> = { debut: 900, message: 900, outil: 2000, apres_outil: 900, arret: 900, fin: 1400 };
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
/** `SessionEnd` de `/clear` ou d'un `/resume` interactif : la conversation change dans le même processus, la session Mnemo continue. */
const RAISONS_IGNOREES = new Set(['clear', 'resume']);

/** Disques qui ne distinguent pas la casse par défaut : les chemins interdits s'y comparent sans casse. */
const SANS_CASSE = process.platform === 'darwin' || process.platform === 'win32';

/**
 * Sortie de Claude Code pour la réponse, ou « » : `additionalContext` (`debut`, `message`) ; pour `outil`, le refus `PreToolUse`
 * documenté (https://code.claude.com/docs/en/hooks : code 0, `permissionDecisionReason` pour Claude, `systemMessage` pour l'utilisateur).
 */
export function sortieDe(evenement: EvenementHook, reponse: ReponseHook): string {
	if (evenement === 'outil') {
		const refus = reponse.refus;
		if (refus === undefined || refus.trim() === '') return '';
		return `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: refus }, systemMessage: refus })}\n`;
	}
	const nom = SORTIES[evenement];
	const contexte = reponse.contexte;
	if (nom === undefined || contexte === undefined || contexte.trim() === '') return '';
	return `${JSON.stringify({ hookSpecificOutput: { hookEventName: nom, additionalContext: contexte } })}\n`;
}

/**
 * stdin entier ; au-delà de `ENTREE_HOOK_MAX_OCTETS`, lu jusqu'au bout (l'écriture de Claude Code ne casse pas) puis écarté ;
 * pas fermé avant `delaiMs` (null : sans délai) : `delai_depasse`.
 */
function lireEntree(delaiMs: number | null): Promise<{ texte: string } | { nonLue: CauseNonVerifiee }> {
	return new Promise((resoudre) => {
		const morceaux: Buffer[] = [];
		let taille = 0;
		let fini = false;
		const terminer = (resultat: { texte: string } | { nonLue: CauseNonVerifiee }): void => {
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

function objetJson(texte: string): Record<string, unknown> | null {
	try {
		const lu: unknown = JSON.parse(texte);
		return estObjet(lu) ? lu : null;
	} catch {
		return null;
	}
}

/**
 * Entrée de Claude Code traduite ; null si elle est à ignorer (`SessionEnd` de `/clear`) ou illisible hors `outil`, qui doit
 * rendre une décision : son action est alors « non lue ». Session : `MNEMO_SESSION`, sinon `session_id` ; « » sans uuid valide.
 */
function traduire(evenement: EvenementHook, options: Set<string>, lecture: { texte: string } | { nonLue: CauseNonVerifiee }, env: NodeJS.ProcessEnv, maintenant: number, cwdProcessus: string): { entree: EntreeHook; transcription?: string } | null {
	const lu = 'texte' in lecture ? objetJson(lecture.texte) : null;
	if (lu === null && evenement !== 'outil') return null;
	const champs = lu ?? {};
	if (evenement === 'fin' && typeof champs.reason === 'string' && RAISONS_IGNOREES.has(champs.reason)) return null;
	const candidates = [env.MNEMO_SESSION, champs.session_id];
	const session = candidates.find((c): c is string => typeof c === 'string' && estUuid(c)) ?? '';
	// Claude Code lance le hook dans son dossier courant : la meilleure position connue quand l'entrée n'en donne pas
	const entree: EntreeHook = { evenement, session, horodatageMs: maintenant, cwd: cheminReel(typeof champs.cwd === 'string' && champs.cwd !== '' ? champs.cwd : cwdProcessus) };
	if (typeof champs.prompt === 'string') entree.prompt = champs.prompt;
	if (evenement === 'debut' && estSourceDeDebut(champs.source)) entree.source = champs.source;
	if (typeof champs.tool_name === 'string') entree.outil = { nom: champs.tool_name, entree: estObjet(champs.tool_input) ? champs.tool_input : {} };
	else if (evenement === 'outil') entree.outil = { nonLue: 'nonLue' in lecture ? lecture.nonLue : 'entree_illisible' };
	if (evenement === 'arret') {
		const notification = options.has('--notification') && !(typeof champs.notification_type === 'string' && NOTIFICATIONS_SANS_DIALOGUE.has(champs.notification_type));
		entree.arret = notification ? 'notification' : 'stop';
	}
	if (options.has('--sans-contexte')) entree.sansContexte = true;
	// hors de l'entrée : le chemin de la transcription ne sert qu'à la jauge de la fenêtre de contexte, chez le service
	return typeof champs.transcript_path === 'string' && champs.transcript_path !== '' ? { entree, transcription: champs.transcript_path } : { entree };
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
	completerClassement: async () => false,
	servis: async () => [],
	ecarter: async () => 'terminee',
	retablir: async () => 'terminee',
	ecartes: async () => [],
	noterFicheServieLueOuEcrite: async () => {},
	fichesServiesLuesOuEcrites: async () => [],
	oublierInjections: async () => {},
	noterMessagePorteur: async () => null,
	noterInjectionManuelle: async () => {},
	injectionsManuelles: async () => [],
	noterGeste: async () => {},
	gestes: async () => [],
	comptesGestes: async () => [],
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
 * `<événement> [options]` : l'événement (nom Mnemo ou Claude Code), puis ses options permises, une fois chacune ; null sinon.
 * `Notification` (nom Claude Code) vaut `arret --notification`.
 */
function lireArguments(args: string[]): { evenement: EvenementHook; options: Set<string> } | null {
	const [nom, ...reste] = args;
	const evenement = nom === undefined ? undefined : EVENEMENTS[nom];
	if (evenement === undefined) return null;
	const options = new Set(reste);
	if (options.size !== reste.length || !reste.every((o) => (OPTIONS[evenement] ?? []).includes(o))) return null;
	if (nom === 'Notification') options.add('--notification');
	return { evenement, options };
}

/**
 * `lectureBornee` faux : l'échéance de la lecture est tenue par l'appelant (`reponseAvantEcheance` pour `outil`) ; `lu.cwd` :
 * le `cwd` de l'entrée dès qu'elle est traduite, pour que l'appelant cherche la même racine.
 */
async function reponse(evenement: EvenementHook, options: Set<string>, temps: { debutMs: number; echeance: number }, lectureBornee: boolean, lu: { cwd: string | null }): Promise<ReponseHook> {
	const lecture = await lireEntree(lectureBornee ? temps.echeance - Date.now() : null);
	// horodatage : le démarrage du processus, au plus près de l'instant de l'événement (ordre des hooks rapprochés)
	const traduite = traduire(evenement, options, lecture, process.env, temps.debutMs, process.cwd());
	if (traduite === null) return {};
	const { entree, transcription } = traduite;
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
async function reponseAvantEcheance(evenement: EvenementHook, options: Set<string>, temps: { debutMs: number; echeance: number }): Promise<ReponseHook> {
	const decide = evenement === 'outil';
	const lu: { cwd: string | null } = { cwd: null };
	const calcul = reponse(evenement, options, temps, !decide, lu).catch((erreur: unknown): ReponseHook => {
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

/**
 * `mnemo hook <événement> [--notification | --sans-contexte]` : appelé par Claude Code (plugin d'une session Mnemo), entrée JSON
 * sur stdin. Le service d'abord (`POST /api/hook`), sinon le calcul ici. Code 0 ; sur stdout, seulement la réponse JSON de Claude
 * Code (`sortieDe`) ; un refus d'`outil` et un accord non vérifié sont écrits sur stderr, gardés par Claude Code dans son journal.
 */
export async function commandeHook(args: string[]): Promise<void> {
	// le démarrage de Node et le chargement des modules comptent dans le budget
	const debutMs = Math.floor(performance.timeOrigin);
	const lu = lireArguments(args);
	if (lu === null) {
		process.stderr.write(`mnemo hook : événement ou option inconnus « ${args.join(' ')} » (debut, message, outil, arret, fin ; --notification, --sans-contexte).\n`);
		terminer('');
		return;
	}
	const { evenement, options } = lu;
	const r = await reponseAvantEcheance(evenement, options, { debutMs, echeance: debutMs + ECHEANCES_MS[evenement] });
	const sortie = sortieDe(evenement, r);
	if (evenement === 'outil' && sortie !== '') process.stderr.write(`mnemo hook : action refusée : ${r.refus}\n`);
	if (r.avis !== undefined) process.stderr.write(`mnemo hook : ${r.avis}\n`);
	terminer(sortie);
}
