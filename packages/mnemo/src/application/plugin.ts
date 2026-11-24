import { DOSSIERS_FIXES } from '@mnemo/commun';
import type { Profil } from '../domaine/profil.ts';
import { EVENEMENTS_HOOK, skillPourProjet } from '../domaine/profil.ts';
import { consignesVerifieesPossibles } from '../domaine/refus-outil.ts';
import { estUuid } from '../domaine/session.ts';
import type { EvenementHook, Session } from '../domaine/session.ts';
import type { Dependances, PluginInstalle } from './ports.ts';
import { deposerSkillsParDefaut, dossierSkillsDuProfil } from './profil.ts';

/** Un fichier du plugin assemblé ; `chemin` relatif au dossier du plugin, séparé par « / ». */
export type FichierPlugin = { chemin: string; texte: string };

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

/** Outils après lesquels Mnemo note ce que Claude a lu ou écrit : un fichier, une fiche lue ou écrite par Mnemo (rien n'est injecté). */
export const MATCHER_APRES_OUTIL = 'Read|Edit|MultiEdit|Write|NotebookEdit|mcp__mnemo__.*';

/**
 * Événements Claude Code de chaque événement Mnemo, avec leur délai (secondes) et leurs options. `PreToolUse` porte le matcher
 * `*` (tous les outils), `PostToolUse` le matcher `MATCHER_APRES_OUTIL` (outils qui lisent ou écrivent un fichier ou une fiche) ;
 * les autres n'en ont pas (`UserPromptSubmit`, `Stop` l'ignorent ; sans matcher, `SessionStart`, `Notification` et `SessionEnd`
 * se déclenchent dans tous les cas). `Notification` passe `--notification` : l'état distingue un dialogue ouvert (permission)
 * d'un tour fini (`Stop`). `bloquantSiConsignes` : voir `hooksJson`.
 */
const EVENEMENTS_CLAUDE: Record<EvenementHook, readonly { nom: string; timeout: number; matcher?: string; options?: string[]; bloquantSiConsignes?: true }[]> = {
	debut: [{ nom: 'SessionStart', timeout: 10 }],
	message: [{ nom: 'UserPromptSubmit', timeout: 5 }],
	outil: [{ nom: 'PreToolUse', timeout: 3, matcher: '*', bloquantSiConsignes: true }],
	apres_outil: [{ nom: 'PostToolUse', timeout: 3, matcher: MATCHER_APRES_OUTIL }],
	arret: [
		{ nom: 'Stop', timeout: 3 },
		{ nom: 'Notification', timeout: 3, options: ['--notification'] },
	],
	fin: [{ nom: 'SessionEnd', timeout: 15 }],
};

/** Hooks qui tiennent l'état de la session (pilote, bilan, interface) : toujours déclarés, quel que soit le profil. */
const HOOKS_D_ETAT: readonly EvenementHook[] = ['debut', 'message', 'arret', 'fin'];
/** Hooks qui servent un contexte : déclarés `--sans-contexte` quand le profil ne les demande pas. */
const HOOKS_DE_CONTEXTE: readonly EvenementHook[] = ['debut', 'message', 'apres_outil'];

/**
 * Outils de Mnemo permis d'avance dans une session (`permissions.allow` du `settings.json`) : `proposer`, que le bilan
 * demande, et la lecture (`diagnostiquer` compris). Sans eux, le bilan s'arrêterait sur une demande de permission. Ni `deplacer`, ni `entretenir`, ni `extraire_source`.
 */
export const OUTILS_PERMIS = ['proposer', 'chercher', 'lire', 'lister', 'voisins', 'chronologie', 'contexte', 'diagnostiquer'].map((nom) => `mcp__mnemo__${nom}`);

/** Comment le plugin appelle Mnemo (`node`, `main`) et la version de Mnemo écrite dans son manifeste. */
export type AppelPlugin = { node: string; main: string; version: string };

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
		const demande = profil.hooks.includes(evenement);
		if (!demande && !HOOKS_D_ETAT.includes(evenement)) continue;
		const sansContexte = !demande && HOOKS_DE_CONTEXTE.includes(evenement) ? ['--sans-contexte'] : [];
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
 * Skills copiées dans le plugin : chaque sous-dossier de `dossier` dont le `SKILL.md` est une fiche listée (fichier ordinaire :
 * un lien symbolique n'est pas listé, donc jamais suivi) et que `garder` accepte (nom du sous-dossier, texte du `SKILL.md`).
 * Rend les fichiers copiés et les noms des skills retenues.
 */
async function skills(dep: Dependances, dossier: string, garder: (nom: string, texteSkill: string) => boolean): Promise<{ fichiers: FichierPlugin[]; noms: Set<string> }> {
	const fichiers: FichierPlugin[] = [];
	const noms = new Set<string>();
	for (const sous of (await dep.coffre.lister(dossier)).dossiers) {
		if (!(await dep.coffre.lister(sous)).fiches.includes(`${sous}/SKILL.md`)) continue;
		const nom = sous.slice(sous.lastIndexOf('/') + 1);
		const texte = await dep.coffre.lire(`${sous}/SKILL.md`);
		if (texte === null || !garder(nom, texte)) continue;
		noms.add(nom);
		fichiers.push(...(await copierDossier(dep, sous, `${DOSSIERS_FIXES.skills}/${nom}`)));
	}
	return { fichiers, noms };
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
 * Skills : celles du profil (`profils/<nom>/skills/`, ses skills par défaut manquantes d'abord déposées, un commit), puis
 * celles de `_mnemo/skills/` retenues par `skillsMemoire` et par leur champ `projets` ; à nom égal, celle du profil gagne.
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
	await deposerSkillsParDefaut(dep, profil.nom);
	const duProfil = await skills(dep, dossierSkillsDuProfil(profil.nom), () => true);
	const retenue = (nom: string) => profil.skillsMemoire === 'tous' || profil.skillsMemoire.includes(nom);
	const deLaMemoire = await skills(dep, DOSSIERS_FIXES.skills, (nom, texte) => !duProfil.noms.has(nom) && retenue(nom) && skillPourProjet(texte, session.projet));
	fichiers.push(...duProfil.fichiers, ...deLaMemoire.fichiers);
	return fichiers;
}

/** `dossier` + `nom`, avec le séparateur du chemin reçu (l'application n'importe pas `node:path`). */
function dans(dossier: string, nom: string): string {
	const separateur = dossier.includes('\\') && !dossier.includes('/') ? '\\' : '/';
	return dossier.endsWith(separateur) ? `${dossier}${nom}` : `${dossier}${separateur}${nom}`;
}

/**
 * Arguments de `claude` : nouvelle session (`--session-id`) ou reprise (`--resume`), le plugin, ses réglages et sa consigne ;
 * un profil lancé dans la mémoire (`lancement: memoire`) reçoit la racine du dossier Mnemo par `--add-dir` (avant le plugin). L'objectif (nouvelle session seulement) est le dernier
 * argument : le prompt initial ; s'il commence par « - », une espace le précède pour qu'il ne soit jamais lu comme une option.
 */
export function argumentsClaude(session: Session, profil: Pick<Profil, 'lancement'>, dossiers: { plugin: string; racine: string }, mode: 'nouvelle' | 'reprise', objectif?: string): string[] {
	if (!estUuid(session.id)) throw new Error(`Identifiant de session invalide (uuid attendu) : « ${session.id} ».`);
	const args = mode === 'nouvelle' ? ['--session-id', session.id] : ['--resume', session.id];
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
 * Environnement de `claude` : celui de l'utilisateur, sans les variables interdites (comparées sans la casse, comme sous
 * Windows), plus la session Mnemo (lue par `mnemo hook` et `mnemo mcp`) et l'auto-mémoire coupée.
 */
export function environnementClaude(env: Record<string, string | undefined>, session: Session, racine: string): Record<string, string> {
	const ajouts: Record<string, string> = { MNEMO_SESSION: session.id, MNEMO_PROJET: session.projet, MNEMO_RACINE: racine, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' };
	const resultat: Record<string, string> = {};
	for (const [cle, valeur] of Object.entries(env)) {
		const majuscules = cle.toUpperCase();
		if (valeur === undefined || estInterdite(majuscules) || majuscules in ajouts) continue;
		resultat[cle] = valeur;
	}
	return { ...resultat, ...ajouts };
}
