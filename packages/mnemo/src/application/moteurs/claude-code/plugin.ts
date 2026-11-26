import { DOSSIERS_FIXES, estModele } from '@mnemo/commun';
import { OUTILS_CLAUDE_CODE, PREFIXE_MCP } from '../../../domaine/moteurs/claude-code/outils.ts';
import { effetDuHook } from '../../../domaine/moteurs/hooks-du-profil.ts';
import { OUTILS_MNEMO_PERMIS } from '../../../domaine/moteurs/outils-permis.ts';
import type { Profil } from '../../../domaine/profil.ts';
import { EVENEMENTS_HOOK } from '../../../domaine/profil.ts';
import { consignesVerifieesPossibles } from '../../../domaine/refus-outil.ts';
import { estUuid } from '../../../domaine/session.ts';
import type { EvenementHook, Session } from '../../../domaine/session.ts';
import type { AppelPlugin, ContextePreparation, Dependances, FichierPlugin, Lancement, PluginInstalle } from '../../ports.ts';
import { environnementAvec, environnementPermis, variablesRetirees } from '../environnement-de-session.ts';
import { skillsDeSession } from '../skills-de-session.ts';

/**
 * Variables que `claude` ne reçoit jamais : seul l'abonnement de l'utilisateur sert, jamais une clé d'API ni un autre
 * fournisseur ; et les marques d'une session Claude Code parente (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`,
 * `CLAUDE_CODE_CHILD_SESSION`), pour qu'un service démarré depuis Claude Code lance quand même ses sessions.
 * S'y ajoute tout sélecteur de fournisseur `CLAUDE_CODE_USE_*` (Bedrock, Vertex, Foundry, Mantle…), voir `estInterdite`.
 */
export const VARIABLES_INTERDITES: readonly string[] = [
	'ANTHROPIC_API_KEY',
	'ANTHROPIC_AUTH_TOKEN',
	'ANTHROPIC_BASE_URL',
	'CLAUDE_CODE_USE_BEDROCK',
	'CLAUDE_CODE_USE_VERTEX',
	'CLAUDECODE',
	'CLAUDE_CODE_ENTRYPOINT',
	'CLAUDE_CODE_CHILD_SESSION',
];

/** `CLAUDE_CODE_USE_*` choisit un fournisseur, sauf `CLAUDE_CODE_USE_POWERSHELL_TOOL` (un outil, gardé). */
const SELECTEUR_FOURNISSEUR = 'CLAUDE_CODE_USE_';
const OUTIL_GARDE = 'CLAUDE_CODE_USE_POWERSHELL_TOOL';

/** Nom de variable (en majuscules) que `claude` ne reçoit pas. */
export function estInterdite(majuscules: string): boolean {
	if (VARIABLES_INTERDITES.includes(majuscules)) return true;
	return majuscules.startsWith(SELECTEUR_FOURNISSEUR) && majuscules !== OUTIL_GARDE;
}

/**
 * Événements Claude Code de chaque événement Mnemo, avec leur délai (secondes) et leurs options. `PreToolUse` porte le matcher
 * `*` (tous les outils), `PostToolUse` le matcher `motifApresOutil` des outils de Claude Code (outils qui lisent ou écrivent un fichier ou une fiche) ;
 * les autres n'en ont pas (`UserPromptSubmit`, `Stop` l'ignorent ; sans matcher, `SessionStart`, `Notification` et `SessionEnd`
 * se déclenchent dans tous les cas). `Notification` passe `--notification` : l'état distingue un dialogue ouvert (permission)
 * d'un tour fini (`Stop`). `bloquantSiConsignes` : voir `hooksJson`.
 */
const EVENEMENTS_CLAUDE: Record<EvenementHook, readonly { nom: string; timeout: number; matcher?: string; options?: string[]; bloquantSiConsignes?: true }[]> = {
	debut: [{ nom: 'SessionStart', timeout: 10 }],
	message: [{ nom: 'UserPromptSubmit', timeout: 5 }],
	outil: [{ nom: 'PreToolUse', timeout: 3, matcher: '*', bloquantSiConsignes: true }],
	apres_outil: [{ nom: 'PostToolUse', timeout: 3, matcher: OUTILS_CLAUDE_CODE.motifApresOutil }],
	arret: [
		{ nom: 'Stop', timeout: 3 },
		{ nom: 'Notification', timeout: 3, options: ['--notification'] },
	],
	fin: [{ nom: 'SessionEnd', timeout: 15 }],
};

/** Outils de Mnemo permis d'avance dans une session (`permissions.allow` du `settings.json`) : `OUTILS_MNEMO_PERMIS`. */
export const OUTILS_PERMIS = OUTILS_MNEMO_PERMIS.map((nom) => `${PREFIXE_MCP}${nom}`);

const json = (valeur: unknown): string => `${JSON.stringify(valeur, null, 2)}\n`;

function verifierAppel(appel: { node: string; main: string }): void {
	for (const chemin of [appel.node, appel.main]) {
		if (chemin.includes('"')) throw new Error(`Chemin refusé pour les hooks (guillemet double) : « ${chemin} ».`);
	}
}

/**
 * `hooks/hooks.json`. Les hooks d'état (`debut`, `message`, `arret`, `fin`) sont toujours là ; le profil décide seulement de
 * ce qu'ils servent (`--sans-contexte` pour `debut` et `message` hors profil) et de la vérification des actions (`outil`,
 * seulement s'il est dans le profil). Forme « exec » de Claude Code (`command` + `args`) : Node est lancé directement, chaque
 * chemin est un argument, sans shell ni guillemets, sur toutes les plateformes (sous Windows, la forme « shell » passerait
 * par Git Bash ou PowerShell).
 */
function hooksJson(profil: Profil, appel: { node: string; main: string }, consignesVerifiees: boolean): string {
	const hooks: Record<string, unknown[]> = {};
	for (const evenement of EVENEMENTS_HOOK) {
		const effet = effetDuHook(evenement, profil.hooks);
		if (effet === 'absent') continue;
		const sansContexte = effet === 'sans_contexte' ? ['--sans-contexte'] : [];
		for (const { nom, timeout, matcher, options, bloquantSiConsignes } of EVENEMENTS_CLAUDE[evenement]) {
			// `onFailure: 'block'` (Claude Code ≥ 2.1.295) : un hook en échec ou hors délai bloque l'outil. Décidé au lancement de la
			// session : une consigne vérifiée ajoutée en cours de session ne le pose qu'à la session suivante.
			const bloquant = bloquantSiConsignes === true && consignesVerifiees ? { onFailure: 'block' } : {};
			const commande = { type: 'command', command: appel.node, args: [appel.main, 'hook', evenement, ...(options ?? []), ...sansContexte], timeout, ...bloquant };
			hooks[nom] = [{ ...(matcher === undefined ? {} : { matcher }), hooks: [commande] }];
		}
	}
	return json({ hooks });
}

/**
 * `statusLine` du `settings.json` de session : `mnemo ligne-etat` transmet au service les quotas du compte (`rate_limits`) que
 * Claude Code donne à sa ligne d'état, pour la barre de titre de l'interface ; elle n'affiche rien. Claude Code la lance par un
 * shell (pas de forme « exec » documentée) : chemins entre guillemets doubles, que `verifierAppel` interdit dans les chemins.
 */
export function ligneEtat(appel: { node: string; main: string }): { type: 'command'; command: string } {
	return { type: 'command', command: `"${appel.node}" "${appel.main}" ligne-etat` };
}

/** Tous les fichiers `.md` de `dossier` (mémoire), récursivement, rangés sous `prefixe` dans le plugin. */
async function copierDossier(dep: Dependances, dossier: string, prefixe: string): Promise<FichierPlugin[]> {
	const { fiches, dossiers } = await dep.coffre.lister(dossier);
	const fichiers: FichierPlugin[] = [];
	for (const chemin of fiches) {
		const texte = await dep.coffre.lire(chemin);
		if (texte !== null) fichiers.push({ chemin: `${prefixe}/${chemin.slice(dossier.length + 1)}`, texte });
	}
	for (const sous of dossiers) fichiers.push(...(await copierDossier(dep, sous, `${prefixe}/${sous.slice(dossier.length + 1)}`)));
	return fichiers;
}

/**
 * `enabledPlugins` du `settings.json` de session : `true` pour chaque plugin installé que le profil liste, `false` pour tout
 * autre plugin installé (il serait sinon actif s'il l'est dans les réglages de l'utilisateur). Un plugin listé mais non
 * installé n'y figure pas.
 */
export function enabledPluginsDe(profil: Pick<Profil, 'plugins'>, installes: readonly PluginInstalle[]): Record<string, boolean> {
	const actives: Record<string, boolean> = {};
	for (const { id } of installes) actives[id] = profil.plugins.includes(id);
	return actives;
}

/**
 * Fichiers du plugin d'une session : manifeste, `hooks/hooks.json` (appel `<node> <main.ts> hook <événement>`),
 * `consigne.md` (passée par `--append-system-prompt-file`), `settings.json` (auto-mémoire coupée, outils de Mnemo du bilan
 * permis d'avance, ligne d'état qui transmet les quotas du compte, plugins Claude Code du profil allumés et tous les autres installés éteints ; passé par `--settings` : un
 * plugin ne peut pas les régler lui-même), skills. Aucun serveur MCP : celui que `mnemo init` déclare à Claude Code suffit.
 * Skills : celles de `skillsDeSession`, chacune copiée avec tous les `.md` de son dossier.
 */
export async function assemblerPlugin(dep: Dependances, session: Session, profil: Profil, appel: AppelPlugin): Promise<FichierPlugin[]> {
	verifierAppel(appel);
	const { plugins } = await dep.pluginsClaude.installes();
	const reglages = { autoMemoryEnabled: false, permissions: { allow: OUTILS_PERMIS }, enabledPlugins: enabledPluginsDe(profil, plugins), statusLine: ligneEtat(appel) };
	const fichiers: FichierPlugin[] = [
		{ chemin: '.claude-plugin/plugin.json', texte: json({ name: `mnemo-${session.id.slice(0, 8)}`, version: appel.version }) },
		{ chemin: 'hooks/hooks.json', texte: hooksJson(profil, appel, consignesVerifieesPossibles(await dep.indicateur.lire())) },
		{ chemin: 'consigne.md', texte: `${profil.consigne.trim()}\n` },
		{ chemin: 'settings.json', texte: json(reglages) },
	];
	for (const skill of await skillsDeSession(dep, session, profil)) fichiers.push(...(await copierDossier(dep, skill.dossier, `${DOSSIERS_FIXES.skills}/${skill.nom}`)));
	return fichiers;
}

/** `dossier` + `nom`, avec le séparateur du chemin reçu (l'application n'importe pas `node:path`). */
function dans(dossier: string, nom: string): string {
	const separateur = dossier.includes('\\') && !dossier.includes('/') ? '\\' : '/';
	return dossier.endsWith(separateur) ? `${dossier}${nom}` : `${dossier}${separateur}${nom}`;
}

/**
 * Arguments de `claude` : nouvelle session (`--session-id`) ou reprise (`--resume`), le modèle de la session (`--model`, s'il
 * n'est pas vide : enregistré au lancement, gardé à la reprise), le plugin, ses réglages et sa consigne ;
 * un profil lancé dans la mémoire (`lancement: memoire`) reçoit la racine du dossier Mnemo par `--add-dir` (avant le plugin). L'objectif (nouvelle session seulement) est le dernier
 * argument : le prompt initial ; s'il commence par « - », une espace le précède pour qu'il ne soit jamais lu comme une option.
 */
export function argumentsClaude(session: Session, profil: Pick<Profil, 'lancement'>, dossiers: { plugin: string; racine: string }, mode: 'nouvelle' | 'reprise', objectif?: string): string[] {
	if (!estUuid(session.id)) throw new Error(`Identifiant de session invalide (uuid attendu) : « ${session.id} ».`);
	const args = mode === 'nouvelle' ? ['--session-id', session.id] : ['--resume', session.id];
	const modele = session.modele ?? '';
	if (!estModele(modele)) throw new Error(`Modèle de session refusé : « ${modele} ».`);
	if (modele !== '') args.push('--model', modele);
	// `--add-dir` prend plusieurs valeurs : placé avant `--plugin-dir`, il n'avale jamais l'objectif.
	if (profil.lancement === 'memoire') args.push('--add-dir', dossiers.racine);
	args.push('--plugin-dir', dossiers.plugin, '--settings', dans(dossiers.plugin, 'settings.json'), '--append-system-prompt-file', dans(dossiers.plugin, 'consigne.md'));
	if (mode === 'nouvelle') args.push(...premierMessage(objectif));
	return args;
}

/** Premier message passé à `claude` (dernier argument) : rien s'il est vide ; un espace devant s'il commence par `-` (jamais lu comme une option). */
export function premierMessage(objectif?: string): string[] {
	if (objectif === undefined || objectif.trim() === '') return [];
	return [objectif.startsWith('-') ? ` ${objectif}` : objectif];
}

/**
 * Environnement de `claude` : celui de l'utilisateur, sans les variables interdites (`estInterdite`) ni celles d'un autre
 * fournisseur (`estDUnAutreFournisseur`), comparées sans la casse comme sous Windows, plus la session Mnemo (lue par `mnemo hook` et `mnemo mcp`), son moteur (`MNEMO_MOTEUR` : les hooks d'un autre
 * moteur lancé depuis la session, qui hérite de `MNEMO_SESSION`, restent inertes) et l'auto-mémoire coupée.
 */
export function environnementClaude(env: Record<string, string | undefined>, session: Session, racine: string): Record<string, string> {
	const ajouts: Record<string, string> = { MNEMO_SESSION: session.id, MNEMO_MOTEUR: 'claude-code', MNEMO_PROJET: session.projet, MNEMO_RACINE: racine, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' };
	return environnementAvec(environnementPermis('claude-code', env, estInterdite), ajouts);
}

/**
 * Environnement d'un `claude -p` qui n'est pas une session Mnemo (le juge du banc) : celui de l'utilisateur, sans les variables
 * interdites ni celles d'un autre fournisseur (comme `environnementClaude`), sans aucune variable `MNEMO_*` (lancé depuis une
 * session Mnemo, il en hériterait : les hooks de Mnemo installés pour tout le poste resteraient actifs et écriraient au
 * journal de cette session), auto-mémoire coupée.
 */
export function environnementClaudeHorsSession(env: Record<string, string | undefined>): Record<string, string> {
	const permis = environnementPermis('claude-code', env, estInterdite);
	const sansMnemo = Object.fromEntries(Object.entries(permis).filter(([cle]) => !cle.toUpperCase().startsWith('MNEMO_')));
	return environnementAvec(sansMnemo, { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' });
}

/**
 * Lancement de `claude` : arguments (`argumentsClaude`, puis à la reprise la consigne tapée d'emblée), environnement ; pour la
 * ligne à coller, les variables de la session et les variables interdites présentes chez l'utilisateur.
 */
export function preparerClaudeCode(c: ContextePreparation): Lancement {
	const args = [...argumentsClaude(c.session, c.profil, { plugin: c.dossierFichiers, racine: c.racine }, c.mode, c.objectif), ...(c.mode === 'reprise' ? premierMessage(c.objectif) : [])];
	return {
		args,
		env: environnementClaude(c.env, c.session, c.racine),
		ajouts: environnementClaude({}, c.session, c.racine),
		retirees: variablesRetirees('claude-code', c.env, estInterdite),
	};
}
