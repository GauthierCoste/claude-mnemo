import { estModele } from '@mnemo/commun';
import { motifSansFil, RE_FIL_SUR } from '../../../domaine/moteurs/fil.ts';
import { OUTILS_MNEMO_PERMIS } from '../../../domaine/moteurs/outils-permis.ts';
import { valeurToml } from '../../../domaine/moteurs/toml.ts';
import type { Profil } from '../../../domaine/profil.ts';
import { estUuid } from '../../../domaine/session.ts';
import type { Session } from '../../../domaine/session.ts';
import { estObjet } from '../../../domaine/valeurs.ts';
import type { AppelPlugin, ContextePreparation, Dependances, FichierPlugin, Lancement } from '../../ports.ts';
import { consigneAvecSkills } from '../consigne-avec-skills.ts';
import { environnementAvec, environnementPermis, VARIABLES_DU_SERVEUR_MCP, variablesDeSession, variablesRetirees } from '../environnement-de-session.ts';
import { skillsDeSession } from '../skills-de-session.ts';

/**
 * Agent de la session chez Mistral Vibe : `mnemo-<uuid>`, le nom de son profil d'agent (`<nom>.toml`) et la marque de la session
 * dans la ligne de commande (`--agent mnemo-<uuid>`, gardé par le lanceur Python quand il passe la main au binaire de Vibe).
 */
export const agentDeSession = (uuid: string): string => `mnemo-${uuid}`;

/**
 * Profil d'agent de la session (Vibe 3.1.5) : `instructions` est ajouté au prompt de Vibe (lu et mesuré : `--agent` ne
 * remplace ni le prompt, ni la politique d'approbation de l'utilisateur, qu'un agent ne peut pas régler). Écrit dans le
 * dossier de session de Mnemo, que `VIBE_AGENT_PATHS` ajoute aux dossiers d'agents de Vibe pour cette session seulement.
 */
export function profilDAgent(consigne: string): string {
	return `display_name = "Mnemo"\ndescription = "Session lancée par Mnemo"\ninstructions = ${valeurToml(consigne)}\n`;
}

/** Fichiers de session de Mistral Vibe : le profil d'agent, avec la consigne (celle du profil puis la liste des skills). */
export async function fichiersDeSessionMistralVibe(dep: Dependances, session: Session, profil: Profil, _appel: AppelPlugin): Promise<FichierPlugin[]> {
	const consigne = consigneAvecSkills(profil, await skillsDeSession(dep, session, profil));
	return [{ chemin: `${agentDeSession(session.id)}.toml`, texte: profilDAgent(consigne) }];
}

/** Pourquoi la session Mistral Vibe ne peut pas être reprise : son `fil` (identifiant chez Vibe, appris au premier hook) est inconnu. */
export function motifSansRepriseMistralVibe(session: Pick<Session, 'fil'>): string | null {
	return motifSansFil(
		session,
		'session Mistral Vibe dont l\'identifiant chez Mistral Vibe est inconnu (aucun hook reçu : hooks de Mnemo absents de hooks.toml, ou Mistral Vibe arrêté avant d\'ouvrir sa session) : elle ne peut pas être reprise',
	);
}

/** Ce que reçoivent les arguments de `vibe`. */
export type AppelArgumentsMistralVibe = { session: Session; profil: Pick<Profil, 'lancement'>; mode: ContextePreparation['mode']; racine: string; objectif?: string };

/**
 * Arguments de `vibe` (interface interactive) : l'agent de la session (`--agent mnemo-<uuid>` : la consigne, et la marque),
 * le modèle (`--model`, nouvelle session seulement, comme Vibe l'exige), la racine du dossier Mnemo (`--add-dir`, `lancement:
 * memoire`), et le premier message après `--` (jamais lu comme une option ni une sous-commande). Reprise : `--resume=<fil>`,
 * le `fil` vérifié (`RE_FIL_SUR`).
 */
export function argumentsMistralVibe(a: AppelArgumentsMistralVibe): string[] {
	const { session } = a;
	if (!estUuid(session.id)) throw new Error(`Identifiant de session invalide (uuid attendu) : « ${session.id} ».`);
	const modele = session.modele ?? '';
	if (!estModele(modele)) throw new Error(`Modèle de session refusé : « ${modele} ».`);
	const motif = a.mode === 'reprise' ? motifSansRepriseMistralVibe(session) : null;
	if (motif !== null) throw new Error(`Reprise impossible : ${motif}.`);
	if (a.mode === 'reprise' && !RE_FIL_SUR.test(session.fil!)) throw new Error(`Identifiant de session Mistral Vibe refusé : « ${session.fil} ».`);
	// `--resume=<fil>` : la valeur collée à l'option n'est jamais lue comme une autre option (mesuré, Vibe 3.1.5)
	const args = a.mode === 'reprise' ? [`--resume=${session.fil!}`] : [];
	args.push('--agent', agentDeSession(session.id));
	if (a.mode === 'nouvelle' && modele !== '') args.push('--model', modele);
	if (a.profil.lancement === 'memoire') args.push('--add-dir', a.racine);
	if (a.objectif !== undefined && a.objectif.trim() !== '') args.push('--', a.objectif);
	return args;
}

/** Une variable JSON de l'utilisateur, lue ; null si elle est absente ou illisible (la session pose alors la sienne seule). */
function json(texte: string | undefined): unknown {
	if (texte === undefined) return null;
	try {
		return JSON.parse(texte);
	} catch {
		return null;
	}
}

/**
 * Variables de Vibe pour la session (une couche de sa configuration, au-dessus de celle de l'utilisateur ; lu et mesuré),
 * ajoutées à celles que l'utilisateur pose déjà :
 * - `VIBE_MCP_SERVERS` : le serveur `mnemo` de ce Node et ce `main.ts`, avec les variables de la session (`deSession`, de
 *   `variablesDeSession`) que lit le serveur MCP dans son `env` (Vibe
 *   ne transmet à un serveur MCP que quelques variables), à la place d'un serveur `mnemo` déclaré (fusion par `name`) ;
 * - `VIBE_TOOLS` : les outils de Mnemo permis d'avance (`mnemo_<outil>`, permission `always`) ;
 * - `VIBE_AGENT_PATHS` : le dossier de session de Mnemo, où est le profil d'agent.
 * Rien n'est écrit dans la configuration de l'utilisateur.
 */
export function variablesDeVibe(env: Record<string, string | undefined>, deSession: Readonly<Record<(typeof VARIABLES_DU_SERVEUR_MCP)[number], string>>, appel: Pick<AppelPlugin, 'node' | 'main'>, dossierFichiers: string): Record<string, string> {
	const serveur = {
		name: 'mnemo',
		transport: 'stdio',
		command: appel.node,
		args: [appel.main, 'mcp'],
		env: Object.fromEntries(VARIABLES_DU_SERVEUR_MCP.map((v) => [v, deSession[v]!])),
	};
	const serveurs = json(env.VIBE_MCP_SERVERS);
	const autres = Array.isArray(serveurs) ? serveurs.filter((s: unknown) => !(estObjet(s) && s.name === 'mnemo')) : [];
	const outils = json(env.VIBE_TOOLS);
	const permis = Object.fromEntries(OUTILS_MNEMO_PERMIS.map((o) => [`mnemo_${o}`, { permission: 'always' }]));
	const chemins = json(env.VIBE_AGENT_PATHS);
	return {
		VIBE_MCP_SERVERS: JSON.stringify([...autres, serveur]),
		VIBE_TOOLS: JSON.stringify({ ...(estObjet(outils) ? outils : {}), ...permis }),
		VIBE_AGENT_PATHS: JSON.stringify([dossierFichiers, ...(Array.isArray(chemins) ? chemins : [])]),
	};
}

/**
 * Environnement de `vibe` : celui de l'utilisateur, plus la session Mnemo (`variablesDeSession` : sans `MNEMO_MOTEUR`, les
 * hooks de Mnemo de `hooks.toml` restent inertes) et les variables de Vibe pour la session (`variablesDeVibe`), qui remplacent
 * celles de l'utilisateur sans tenir compte de la casse.
 */
export function environnementMistralVibe(env: Record<string, string | undefined>, c: Pick<ContextePreparation, 'session' | 'profil' | 'racine' | 'appel' | 'dossierFichiers'>): Record<string, string> {
	const deSession = variablesDeSession('mistral-vibe', c.session, c.profil, c.racine);
	return { ...deSession, ...variablesDeVibe(env, deSession, c.appel, c.dossierFichiers) };
}

/**
 * Lancement de `vibe` : arguments (`argumentsMistralVibe`), environnement sans les variables d'un autre fournisseur ; pour la
 * ligne à coller, les variables de la session et celles retirées.
 */
export function preparerMistralVibe(c: ContextePreparation): Lancement {
	const args = argumentsMistralVibe({ session: c.session, profil: c.profil, mode: c.mode, racine: c.racine, ...(c.objectif === undefined ? {} : { objectif: c.objectif }) });
	const ajouts = environnementMistralVibe(c.env, c);
	return { args, env: environnementAvec(environnementPermis('mistral-vibe', c.env), ajouts), ajouts, retirees: variablesRetirees('mistral-vibe', c.env) };
}
