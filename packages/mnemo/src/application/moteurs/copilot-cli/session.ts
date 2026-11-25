import { estModele } from '@mnemo/commun';
import { OUTILS_MNEMO_PERMIS } from '../../../domaine/moteurs/outils-permis.ts';
import type { Profil } from '../../../domaine/profil.ts';
import { estUuid } from '../../../domaine/session.ts';
import type { Session } from '../../../domaine/session.ts';
import type { AppelPlugin, ContextePreparation, Dependances, FichierPlugin, Lancement } from '../../ports.ts';
import { consigneAvecSkills } from '../consigne-avec-skills.ts';
import { environnementAvec, environnementPermis, VARIABLES_DU_SERVEUR_MCP, variablesDeSession, variablesRetirees } from '../environnement-de-session.ts';
import { skillsDeSession } from '../skills-de-session.ts';

/**
 * Fichier de consigne de la session, relatif au dossier de session de Mnemo : GitHub Copilot CLI injecte dans son prompt
 * système chaque `<dossier>/.github/instructions/*.instructions.md` d'un dossier de `COPILOT_CUSTOM_INSTRUCTIONS_DIRS`
 * (1.0.116, mesuré ; ce type de fichier seulement), avec ou sans bloc d'en-tête (`applyTo`), qu'il recopie tel quel.
 */
export const FICHIER_DE_CONSIGNE = '.github/instructions/mnemo.instructions.md';

/** Variable de Copilot : dossiers d'instructions ajoutés, séparés par des virgules (lu et mesuré). */
const DOSSIERS_D_INSTRUCTIONS = 'COPILOT_CUSTOM_INSTRUCTIONS_DIRS';

/**
 * Le fichier de consigne : la consigne et la liste des skills, sans bloc d'en-tête (Copilot l'injecte sans, mesuré, et
 * recopierait l'en-tête dans son prompt) ; une consigne qui commence par `---` est précédée d'une ligne vide, pour ne jamais
 * se lire comme un en-tête.
 */
export const texteDeConsigne = (consigne: string): string => `${consigne.startsWith('---') ? '\n' : ''}${consigne.replace(/\n*$/u, '')}\n`;

/** Fichiers de session de GitHub Copilot CLI : le fichier de consigne (celle du profil puis la liste des skills). */
export async function fichiersDeSessionCopilotCli(dep: Dependances, session: Session, profil: Profil, _appel: AppelPlugin): Promise<FichierPlugin[]> {
	const consigne = consigneAvecSkills(profil, await skillsDeSession(dep, session, profil));
	return [{ chemin: FICHIER_DE_CONSIGNE, texte: texteDeConsigne(consigne) }];
}

/** Ce que reçoivent les arguments de `copilot`. */
export type AppelArgumentsCopilotCli = {
	session: Session;
	profil: Pick<Profil, 'lancement'>;
	racine: string;
	deSession: Readonly<Record<(typeof VARIABLES_DU_SERVEUR_MCP)[number], string>>;
	appel: Pick<AppelPlugin, 'node' | 'main'>;
	objectif?: string;
};

/**
 * Déclaration du serveur `mnemo` pour la session (`--additional-mcp-config`, JSON ; mesuré : prioritaire sur `mcp-config.json`
 * pour cette session) : ce Node et ce `main.ts`, avec les variables de la session que lit le serveur MCP dans son `env`.
 */
export function declarationDeSession(appel: Pick<AppelPlugin, 'node' | 'main'>, deSession: AppelArgumentsCopilotCli['deSession']): string {
	const env = Object.fromEntries(VARIABLES_DU_SERVEUR_MCP.map((v) => [v, deSession[v]]));
	return JSON.stringify({ mcpServers: { mnemo: { type: 'local', command: appel.node, args: [appel.main, 'mcp'], env, tools: ['*'] } } });
}

/**
 * Arguments de `copilot` (interface interactive), chaque valeur collée à son option (`--opt=<valeur>` : jamais lue comme une
 * autre option, mesuré) :
 * - `--session-id=<uuid Mnemo>`, en nouvelle session comme en reprise : l'identifiant chez Copilot est celui de Mnemo (le
 *   `fil`), et la marque de la session dans la ligne de commande ; `--resume` échoue pour une session sans aucun message
 *   (« No session … matched », mesuré), `--session-id` la commence ou la reprend ;
 * - le modèle (`--model`), la racine du dossier Mnemo (`--add-dir`, `lancement: memoire`) ;
 * - le serveur `mnemo` de la session (`--additional-mcp-config`, `--enable-mcp-server=mnemo` s'il était désactivé) et ses
 *   outils permis d'avance (`--allow-tool=mnemo(<outil>)`) ;
 * - le premier message (`--interactive=<texte>`), envoyé par Copilot une fois l'écran de confiance réglé par l'utilisateur.
 * `--trust-folder` est refusé par Copilot avec `--session-id` (mesuré) : la confiance du dossier reste à l'utilisateur.
 */
export function argumentsCopilotCli(a: AppelArgumentsCopilotCli): string[] {
	const { session } = a;
	if (!estUuid(session.id)) throw new Error(`Identifiant de session invalide (uuid attendu) : « ${session.id} ».`);
	const modele = session.modele ?? '';
	if (!estModele(modele)) throw new Error(`Modèle de session refusé : « ${modele} ».`);
	const args = [`--session-id=${session.id}`];
	if (modele !== '') args.push(`--model=${modele}`);
	if (a.profil.lancement === 'memoire') args.push(`--add-dir=${a.racine}`);
	args.push(`--additional-mcp-config=${declarationDeSession(a.appel, a.deSession)}`, '--enable-mcp-server=mnemo');
	for (const outil of OUTILS_MNEMO_PERMIS) args.push(`--allow-tool=mnemo(${outil})`);
	if (a.objectif !== undefined && a.objectif.trim() !== '') args.push(`--interactive=${a.objectif}`);
	return args;
}

/**
 * Variables de Copilot pour la session : le dossier de session de Mnemo ajouté en tête de `COPILOT_CUSTOM_INSTRUCTIONS_DIRS`
 * (ceux de l'utilisateur gardés après). Un dossier qui porte une virgule, le séparateur, est refusé.
 */
export function variablesDeCopilot(env: Record<string, string | undefined>, dossierFichiers: string): Record<string, string> {
	if (dossierFichiers.includes(',')) throw new Error(`Dossier de session refusé par GitHub Copilot CLI (virgule dans le chemin) : « ${dossierFichiers} ».`);
	const autres = env[DOSSIERS_D_INSTRUCTIONS];
	return { [DOSSIERS_D_INSTRUCTIONS]: autres === undefined || autres.trim() === '' ? dossierFichiers : `${dossierFichiers},${autres}` };
}

/**
 * Lancement de `copilot` : arguments (`argumentsCopilotCli`), environnement de l'utilisateur (sans les variables d'un autre
 * fournisseur) plus la session Mnemo
 * (`variablesDeSession` : sans `MNEMO_MOTEUR`, les hooks de Mnemo de `hooks/mnemo.json` restent inertes) et la consigne
 * (`variablesDeCopilot`) ; pour la ligne à coller, ces variables et celles retirées.
 */
export function preparerCopilotCli(c: ContextePreparation): Lancement {
	const deSession = variablesDeSession('copilot-cli', c.session, c.profil, c.racine);
	const args = argumentsCopilotCli({ session: c.session, profil: c.profil, racine: c.racine, deSession, appel: c.appel, ...(c.objectif === undefined ? {} : { objectif: c.objectif }) });
	const ajouts = { ...deSession, ...variablesDeCopilot(c.env, c.dossierFichiers) };
	return { args, env: environnementAvec(environnementPermis('copilot-cli', c.env), ajouts), ajouts, retirees: variablesRetirees('copilot-cli', c.env) };
}
