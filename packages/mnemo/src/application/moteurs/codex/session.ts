import { estModele } from '@mnemo/commun';
import { separerFrontmatter } from '../../../domaine/fiche.ts';
import { listeValeursToml, valeurToml } from '../../../domaine/moteurs/codex/toml.ts';
import { texteDesHooks } from '../../../domaine/moteurs/hooks-du-profil.ts';
import { OUTILS_MNEMO_PERMIS } from '../../../domaine/moteurs/outils-permis.ts';
import type { Profil } from '../../../domaine/profil.ts';
import { estUuid } from '../../../domaine/session.ts';
import type { Session } from '../../../domaine/session.ts';
import type { AppelPlugin, ContextePreparation, Dependances, FichierPlugin, Lancement, ModeLancement } from '../../ports.ts';
import { skillsDeSession } from '../skills-de-session.ts';
import type { SkillDeSession } from '../skills-de-session.ts';

/**
 * Variables que `codex` ne reçoit jamais : `CODEX_API_KEY`, la clé d'API propre à Codex, qui prendrait le pas sur l'abonnement.
 * `OPENAI_API_KEY` et `OPENAI_BASE_URL` restent : elles servent aux passerelles et aux autres fournisseurs que l'utilisateur
 * règle, et Codex connecté par l'abonnement ne s'en sert pas.
 */
export const VARIABLES_INTERDITES_CODEX: readonly string[] = ['CODEX_API_KEY'];

/**
 * Longueur au plus de la consigne de session (`developer_instructions`, citée) : elle passe en argument de la ligne de
 * commande, que Windows borne à 32 767 caractères en tout. Codex n'a pas de clé qui lise des instructions ajoutées depuis un
 * fichier (`model_instructions_file` remplace les siennes : mesuré au lot 5).
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

/**
 * Variables de la session que le serveur MCP `mnemo` lancé par Codex reçoit (`env_vars`) : Codex ne transmet à un serveur
 * MCP qu'un petit nombre de variables de son environnement.
 */
const VARIABLES_DU_SERVEUR_MCP = ['MNEMO_SESSION', 'MNEMO_MOTEUR', 'MNEMO_PROJET', 'MNEMO_RACINE'];

/** Fichier de session qui garde la consigne passée à Codex (`developer_instructions`), pour qu'on puisse la relire. */
const CONSIGNE = 'consigne.md';

/** Longueur au plus d'une description de skill dans la consigne : elle n'est qu'un indice, la skill se lit par `lire`. */
const DESCRIPTION_MAX = 300;

/** Identifiant de session de Codex (`fil`), borné comme l'accepte le service. */
const FIL_MAX = 200;

/** Description d'une skill (frontmatter de son `SKILL.md`), sur une ligne ; « » si elle n'en a pas ou s'il est illisible. */
function descriptionDe(skill: SkillDeSession): string {
	try {
		const valeur = separerFrontmatter(`${skill.dossier}/SKILL.md`, skill.texte).entete['description'];
		if (typeof valeur !== 'string') return '';
		const ligne = valeur.replace(/\s+/gu, ' ').trim();
		return ligne.length <= DESCRIPTION_MAX ? ligne : `${ligne.slice(0, DESCRIPTION_MAX - 1)}…`;
	} catch {
		return '';
	}
}

/**
 * Consigne d'une session Codex (`developer_instructions`) : celle du profil, puis la liste des skills de la session. Codex ne
 * lit de skills que dans le dépôt et chez l'utilisateur (lot 0) : rien n'est écrit dans le dossier du projet, chaque skill
 * est nommée avec sa description et l'identifiant de son `SKILL.md`, lu par l'outil `lire` de Mnemo quand elle s'applique.
 */
export function consigneCodex(profil: Pick<Profil, 'consigne'>, skills: readonly SkillDeSession[]): string {
	const consigne = profil.consigne.trim();
	if (skills.length === 0) return `${consigne}\n`;
	const lignes = skills.map((s) => {
		const description = descriptionDe(s);
		return `- ${s.nom}${description === '' ? '' : ` : ${description}`} (\`${s.dossier}/SKILL.md\`)`;
	});
	return [
		consigne,
		'',
		'## Skills de Mnemo',
		'',
		'Ces skills sont dans la mémoire Mnemo, pas sur le disque du projet. Quand l\'une s\'applique à ta tâche, lis d\'abord son `SKILL.md` avec l\'outil `lire` de Mnemo (identifiant entre parenthèses), puis suis-la ; ses autres fichiers sont dans le même dossier (`lister`).',
		'',
		...lignes,
		'',
	].join('\n');
}

/** Fichiers de session de Codex : sa consigne seulement (avec la liste des skills), relue par `preparerCodex`. */
export async function fichiersDeSessionCodex(dep: Dependances, session: Session, profil: Profil, _appel: AppelPlugin): Promise<FichierPlugin[]> {
	return [{ chemin: CONSIGNE, texte: consigneCodex(profil, await skillsDeSession(dep, session, profil)) }];
}

/** Pourquoi la session Codex ne peut pas être reprise : son `fil` (identifiant chez Codex) n'est pas connu ; null sinon. */
export function motifSansRepriseCodex(session: Pick<Session, 'fil'>): string | null {
	const fil = session.fil ?? '';
	if (fil !== '' && fil.length <= FIL_MAX) return null;
	return 'session Codex dont l\'identifiant chez Codex est inconnu (aucun hook reçu : hooks de Mnemo absents ou non approuvés dans Codex, ou aucun message envoyé) : elle ne peut pas être reprise';
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

/** Environnement de l'utilisateur sans les variables interdites à Codex (comparées sans la casse), pour tout `codex` lancé par Mnemo. */
export function environnementPermisCodex(env: Record<string, string | undefined>): Record<string, string> {
	const resultat: Record<string, string> = {};
	for (const [cle, valeur] of Object.entries(env)) if (valeur !== undefined && !estInterditeCodex(cle.toUpperCase())) resultat[cle] = valeur;
	return resultat;
}

/**
 * Environnement de `codex` : celui de l'utilisateur, sans les variables interdites (comparées sans la casse, comme sous
 * Windows), plus la session Mnemo (lue par `mnemo hook` et `mnemo mcp`), son moteur (`MNEMO_MOTEUR=codex` : sans lui, les
 * hooks de Mnemo installés pour tout le poste restent inertes) et les hooks que le profil demande (`MNEMO_HOOKS` : les hooks
 * de Codex, communs à toutes les sessions, en tirent ce que le plugin d'une session Claude Code déclare).
 */
export function environnementCodex(env: Record<string, string | undefined>, session: Session, profil: Pick<Profil, 'hooks'>, racine: string): Record<string, string> {
	const ajouts: Record<string, string> = { MNEMO_SESSION: session.id, MNEMO_MOTEUR: 'codex', MNEMO_PROJET: session.projet, MNEMO_RACINE: racine, MNEMO_HOOKS: texteDesHooks(profil.hooks) };
	const resultat = environnementPermisCodex(env);
	for (const cle of Object.keys(resultat)) if (cle.toUpperCase() in ajouts) delete resultat[cle];
	return { ...resultat, ...ajouts };
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
		retirees: Object.keys(c.env).filter((cle) => c.env[cle] !== undefined && estInterditeCodex(cle.toUpperCase())),
	};
}
