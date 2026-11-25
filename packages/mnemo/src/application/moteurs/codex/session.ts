import { estModele } from '@mnemo/commun';
import { listeValeursToml, valeurToml } from '../../../domaine/moteurs/toml.ts';
import { motifSansFil } from '../../../domaine/moteurs/fil.ts';
import { OUTILS_MNEMO_PERMIS } from '../../../domaine/moteurs/outils-permis.ts';
import type { Profil } from '../../../domaine/profil.ts';
import { estUuid } from '../../../domaine/session.ts';
import type { Session } from '../../../domaine/session.ts';
import type { AppelPlugin, ContextePreparation, Dependances, FichierPlugin, Lancement, ModeLancement } from '../../ports.ts';
import { consigneAvecSkills } from '../consigne-avec-skills.ts';
import { environnementAvec, environnementPermis, VARIABLES_DU_SERVEUR_MCP, variablesDeSession, variablesRetirees } from '../environnement-de-session.ts';
import { skillsDeSession } from '../skills-de-session.ts';

/**
 * Variables que `codex` ne reçoit jamais : `CODEX_API_KEY`, la clé d'API propre à Codex, qui prendrait le pas sur l'abonnement.
 * `OPENAI_API_KEY` et `OPENAI_BASE_URL` restent : elles servent aux passerelles et aux autres fournisseurs que l'utilisateur
 * règle, et Codex connecté par l'abonnement ne s'en sert pas.
 */
export const VARIABLES_INTERDITES_CODEX: readonly string[] = ['CODEX_API_KEY'];

/**
 * Longueur au plus de la consigne de session (`developer_instructions`, citée) : elle passe en argument de la ligne de
 * commande, que Windows borne à 32 767 caractères en tout. Codex n'a pas de clé qui lise des instructions ajoutées depuis un
 * fichier (`model_instructions_file` remplace les siennes : mesuré).
 */
export const CONSIGNE_MAX = 24_000;

/**
 * Longueur au plus de tous les arguments de `codex` sur la ligne de commande (`longueurSurLaLigne`) : Windows borne la ligne
 * entière à 32 767 caractères ; la marge laisse place au chemin de la commande et à ce qui la précède.
 */
export const LIGNE_ARGUMENTS_MAX = 30_000;

/**
 * Longueur des arguments sur une ligne de commande Windows, au pire : chacun entre guillemets, séparé par une espace, chaque
 * guillemet double et chaque barre oblique inverse doublés.
 */
export const longueurSurLaLigne = (args: readonly string[]): number => args.reduce((total, a) => total + a.length + (a.match(/["\\]/gu)?.length ?? 0) + 3, 0);

/** Fichier de session qui garde la consigne passée à Codex (`developer_instructions`), pour qu'on puisse la relire. */
const CONSIGNE = 'consigne.md';


/** Fichiers de session de Codex : sa consigne seulement (avec la liste des skills), relue par `preparerCodex`. */
export async function fichiersDeSessionCodex(dep: Dependances, session: Session, profil: Profil, _appel: AppelPlugin): Promise<FichierPlugin[]> {
	return [{ chemin: CONSIGNE, texte: consigneAvecSkills(profil, await skillsDeSession(dep, session, profil)) }];
}

/** Pourquoi la session Codex ne peut pas être reprise : son `fil` (identifiant chez Codex) n'est pas connu ; null sinon. */
export function motifSansRepriseCodex(session: Pick<Session, 'fil'>): string | null {
	return motifSansFil(
		session,
		'session Codex dont l\'identifiant chez Codex est inconnu (aucun hook reçu : hooks de Mnemo absents ou non approuvés dans Codex, ou aucun message envoyé) : elle ne peut pas être reprise',
	);
}

/** Ce que reçoivent les arguments de `codex`. */
export type AppelArgumentsCodex = {
	session: Session;
	profil: Pick<Profil, 'lancement'>;
	mode: ModeLancement;
	consigne: string;
	racine: string;
	appel: Pick<AppelPlugin, 'node' | 'main'>;
	objectif?: string;
};

/**
 * Arguments de `codex` (interface interactive) : la marque de la session (`-c mnemo_session="<uuid>"`, clé inconnue tolérée
 * par Codex, lue dans la ligne de commande du processus), sans serveur partagé en arrière-plan (`--no-daemon` : la session
 * tourne dans ce processus, avec l'environnement de Mnemo que ses hooks héritent), sans écran alternatif (`--no-alt-screen` :
 * l'historique reste dans le terminal de la session, avertissement de Mnemo compris), mémoire native coupée, modèle de la session
 * (`-m`, s'il n'est pas vide), racine du dossier Mnemo par `--add-dir` (`lancement: memoire`), consigne
 * (`developer_instructions`, `CONSIGNE_MAX` au plus), serveur MCP `mnemo` allumé (ce Node, ce `main.ts`, les variables de la
 * session) et ses outils de lecture et `proposer` approuvés d'avance. Chaque valeur `-c` est du TOML (`valeurToml` : littérale
 * quand c'est possible, sans guillemet double). Reprise : `codex resume`, les mêmes
 * options, puis le `fil`. Le premier message (objectif, ou consigne tapée d'emblée à la reprise) suit `--`. Lève si la ligne
 * dépasse `LIGNE_ARGUMENTS_MAX`.
 */
export function argumentsCodex(a: AppelArgumentsCodex): string[] {
	const { session } = a;
	if (!estUuid(session.id)) throw new Error(`Identifiant de session invalide (uuid attendu) : « ${session.id} ».`);
	const modele = session.modele ?? '';
	if (!estModele(modele)) throw new Error(`Modèle de session refusé : « ${modele} ».`);
	const motif = a.mode === 'reprise' ? motifSansRepriseCodex(session) : null;
	if (motif !== null) throw new Error(`Reprise impossible : ${motif}.`);
	const consigne = valeurToml(a.consigne);
	if (consigne.length > CONSIGNE_MAX) {
		throw new Error(`Consigne de session trop longue pour la ligne de commande de Codex (${consigne.length} caractères, ${CONSIGNE_MAX} au plus) : raccourcis la consigne du profil ou retiens moins de skills.`);
	}
	const options = ['-c', `mnemo_session=${valeurToml(session.id)}`, '--no-daemon', '--no-alt-screen', '--disable', 'memories'];
	if (modele !== '') options.push('-m', modele);
	if (a.profil.lancement === 'memoire') options.push('--add-dir', a.racine);
	options.push('-c', `developer_instructions=${consigne}`);
	// le serveur `mnemo` est allumé pour la session, même éteint chez l'utilisateur : une session Mnemo a besoin de Mnemo
	options.push('-c', `mcp_servers.mnemo.command=${valeurToml(a.appel.node)}`, '-c', `mcp_servers.mnemo.args=${listeValeursToml([a.appel.main, 'mcp'])}`, '-c', 'mcp_servers.mnemo.enabled=true');
	options.push('-c', `mcp_servers.mnemo.env_vars=${listeValeursToml(VARIABLES_DU_SERVEUR_MCP)}`);
	for (const outil of OUTILS_MNEMO_PERMIS) options.push('-c', `mcp_servers.mnemo.tools.${outil}.approval_mode='approve'`);
	const message = a.objectif === undefined || a.objectif.trim() === '' ? [] : [a.objectif];
	const args = a.mode === 'nouvelle' ? [...options, ...(message.length === 0 ? [] : ['--', ...message])] : ['resume', ...options, '--', session.fil!, ...message];
	const longueur = longueurSurLaLigne(args);
	if (longueur > LIGNE_ARGUMENTS_MAX) {
		throw new Error(`Ligne de commande de Codex trop longue (${longueur} caractères, ${LIGNE_ARGUMENTS_MAX} au plus : Windows la borne à 32 767) : raccourcis la consigne du profil ou l'objectif, ou retiens moins de skills.`);
	}
	return args;
}

const estInterditeCodex = (majuscules: string): boolean => VARIABLES_INTERDITES_CODEX.includes(majuscules);

/**
 * Environnement de l'utilisateur sans les variables interdites à Codex ni celles d'un autre fournisseur (comparées sans la
 * casse), pour tout `codex` lancé par Mnemo.
 */
export function environnementPermisCodex(env: Record<string, string | undefined>): Record<string, string> {
	return environnementPermis('codex', env, estInterditeCodex);
}

/**
 * Environnement de `codex` : celui de l'utilisateur, sans les variables interdites (comparées sans la casse, comme sous
 * Windows), plus la session Mnemo (lue par `mnemo hook` et `mnemo mcp`), son moteur (`MNEMO_MOTEUR=codex` : sans lui, les
 * hooks de Mnemo installés pour tout le poste restent inertes) et les hooks que le profil demande (`MNEMO_HOOKS` : les hooks
 * de Codex, communs à toutes les sessions, en tirent ce que le plugin d'une session Claude Code déclare).
 */
export function environnementCodex(env: Record<string, string | undefined>, session: Session, profil: Pick<Profil, 'hooks'>, racine: string): Record<string, string> {
	return environnementAvec(environnementPermisCodex(env), variablesDeSession('codex', session, profil, racine));
}

/**
 * Lancement de `codex` : arguments (`argumentsCodex`, consigne relue dans les fichiers de session), environnement ; pour la
 * ligne à coller, les variables de la session et les variables interdites présentes chez l'utilisateur.
 */
export function preparerCodex(c: ContextePreparation): Lancement {
	const consigne = c.fichiers.find((f) => f.chemin === CONSIGNE)?.texte ?? `${c.profil.consigne.trim()}\n`;
	const args = argumentsCodex({ session: c.session, profil: c.profil, mode: c.mode, consigne, racine: c.racine, appel: c.appel, ...(c.objectif === undefined ? {} : { objectif: c.objectif }) });
	return {
		args,
		env: environnementCodex(c.env, c.session, c.profil, c.racine),
		ajouts: environnementCodex({}, c.session, c.profil, c.racine),
		retirees: variablesRetirees('codex', c.env, estInterditeCodex),
	};
}
