/**
 * Ce que Mnemo a installé hors de l'app, et vers quoi cela pointe : la commande `mnemo` (`~/.local/bin/mnemo`, écrite par
 * `mnemo commande`), la déclaration MCP de Claude Code (`mcpServers.mnemo` de `~/.claude.json`, portée utilisateur) et
 * l'entrée `mnemo` de l'app Claude (`mcpServers.mnemo` de `claude_desktop_config.json`). Lus tels quels (l'app n'importe
 * pas le code de `mnemo`) ; mêmes marques que lui : l'identifiant de la commande, `<…>/adaptateurs/cli/main.ts mcp`.
 *
 * Au lancement, l'app empaquetée refait ce qui est de Mnemo mais pointe ailleurs (mise à jour de l'app, déplacement, ancienne
 * installation depuis le dépôt) ; ce qui est absent ou n'est pas de Mnemo n'est jamais touché.
 */
import type { Lancement } from './configuration.ts';
import { memeChemin, type PlateformeApp } from './plateforme.ts';

/**
 * `absent` ; `nous` : lance ce Node et ce `main.ts` ; `ailleurs` : de Mnemo, mais un autre Node ou un autre `main.ts` ;
 * `autre` : le même nom pour autre chose (ou illisible) : jamais touché.
 */
export type EtatElement = 'absent' | 'nous' | 'ailleurs' | 'autre';

export type EtatInstallation = { commande: EtatElement; claudeCode: EtatElement; appClaude: EtatElement };

/** Ce qui s'installe hors de l'app. */
export type ElementInstalle = keyof EtatInstallation;

/** Marque de la commande écrite par Mnemo (`IDENTIFIANT_COMMANDE` de `packages/mnemo/src/infra/commande-mnemo.ts`). */
export const MARQUE_COMMANDE = '(local.mnemo.commande)';

/** Ce que l'app attend : son Node, son `main.ts`, et l'adresse `file://` de ce dernier (calculée par l'infra). */
export type Attendu = Lancement & { mainUrl: string };

/**
 * État de la commande d'après le texte du script (null : absent). Le script de Mnemo commence par `#!<node>` et importe
 * `<mainUrl>` (l'adresse `file://` de `main.ts`, entre guillemets JSON).
 */
export function etatCommande(texte: string | null, attendu: Attendu): EtatElement {
	if (texte === null) return 'absent';
	if (!texte.includes(MARQUE_COMMANDE)) return 'autre';
	const [premiere] = texte.split('\n');
	return premiere === `#!${attendu.node}` && texte.includes(`import(${JSON.stringify(attendu.mainUrl)})`) ? 'nous' : 'ailleurs';
}

const MAIN_MNEMO = /adaptateurs[\\/]cli[\\/]main\.ts$/u;

/**
 * État d'une entrée MCP `mnemo` (`{ command, args, … }`, `undefined` : absente). Sous Windows, les chemins se comparent sans
 * tenir compte de la casse ni du sens des séparateurs (`memeChemin`).
 */
export function etatEntreeMcp(entree: unknown, attendu: Lancement, plateforme: PlateformeApp): EtatElement {
	if (entree === undefined) return 'absent';
	if (typeof entree !== 'object' || entree === null || Array.isArray(entree)) return 'autre';
	const { command, args } = entree as Record<string, unknown>;
	if (typeof command !== 'string' || !Array.isArray(args) || args.length < 2 || args[1] !== 'mcp' || typeof args[0] !== 'string') return 'autre';
	if (memeChemin(command, attendu.node, plateforme) && memeChemin(args[0], attendu.main, plateforme)) return 'nous';
	return MAIN_MNEMO.test(args[0]) ? 'ailleurs' : 'autre';
}

/** `mcpServers.mnemo` d'un fichier de configuration (JSON analysé ; null : absent ou illisible) ; `undefined` : absente. */
export function entreeMnemo(brut: unknown): unknown {
	if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) return undefined;
	const serveurs = (brut as Record<string, unknown>)['mcpServers'];
	if (typeof serveurs !== 'object' || serveurs === null || Array.isArray(serveurs) || !Object.hasOwn(serveurs, 'mnemo')) return undefined;
	return (serveurs as Record<string, unknown>)['mnemo'];
}

/**
 * L'entrée `mnemo` de l'app Claude peut-elle être refaite par le service sans rien perdre ? Le service réécrit l'entrée
 * entière (`{ command, args: [main, "mcp"], env: { MNEMO_RACINE: <sa racine> } }`) : seulement si elle a déjà cette forme,
 * pour la même racine. Une autre racine (l'app Claude branchée sur une autre mémoire), une autre variable ou un autre champ
 * ajoutés à la main : laissée.
 */
export function entreeAppClaudeRefaisable(entree: unknown, racine: string): boolean {
	if (typeof entree !== 'object' || entree === null || Array.isArray(entree)) return false;
	const e = entree as Record<string, unknown>;
	if (!Object.keys(e).every((cle) => cle === 'command' || cle === 'args' || cle === 'env' || (cle === 'type' && e['type'] === 'stdio'))) return false;
	if (!Array.isArray(e['args']) || e['args'].length !== 2) return false;
	const env = e['env'];
	if (typeof env !== 'object' || env === null || Array.isArray(env)) return false;
	const cles = Object.keys(env);
	return cles.length === 1 && cles[0] === 'MNEMO_RACINE' && (env as Record<string, unknown>)['MNEMO_RACINE'] === racine;
}

/** Ce que la vérification au lancement refait : ce qui est de Mnemo et pointe ailleurs, dans cet ordre. */
export function aRefaire(etat: EtatInstallation): ElementInstalle[] {
	return (['commande', 'claudeCode', 'appClaude'] as const).filter((e) => etat[e] === 'ailleurs');
}

/**
 * La configuration de l'app Claude sans l'entrée `mnemo` (les autres clés et serveurs gardés tels quels, dans leur ordre) ;
 * texte écrit comme `mnemo` l'écrit (JSON indenté de 2 espaces, `\n` final). `brut` : le fichier analysé.
 */
export function texteSansEntreeMnemo(brut: Record<string, unknown>): string {
	const serveurs = { ...(brut['mcpServers'] as Record<string, unknown>) };
	delete serveurs['mnemo'];
	return `${JSON.stringify({ ...brut, mcpServers: serveurs }, null, 2)}\n`;
}
