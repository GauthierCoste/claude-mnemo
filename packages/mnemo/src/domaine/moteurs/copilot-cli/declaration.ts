import { citerPosix, citerPowerShell } from '../../citer.ts';
import { estObjet } from '../../valeurs.ts';
import type { LancementMcp } from '../declaration-mnemo.ts';
import { lireJsonc, styleJson, texteJson } from '../json-texte.ts';

/**
 * Déclaration du serveur `mnemo` dans `mcp-config.json` de GitHub Copilot CLI (1.0.116, JSONC lu par Copilot :
 * `{ "mcpServers": { "mnemo": { "type": "local" | "stdio", "command", "args", "env", "cwd", "tools": ["*"] … } } }`).
 * `lancement` : null pour un autre type ou une commande illisible ; `reglages` : ce qu'elle porte que Mnemo ne pose pas
 * (`tools` autre que `["*"]` compris).
 */
export type DeclarationCopilotCli = { lancement: LancementMcp | null; reglages: string[] };

/** Clés que Mnemo écrit dans sa déclaration. */
const CLES_DE_MNEMO = new Set(['type', 'command', 'args', 'tools']);

/** Ce que Mnemo écrit : un serveur local qui lance `<node> <main> mcp`, tous ses outils offerts (comme `copilot mcp add`). */
export const entreeDeDeclaration = (node: string, main: string): Record<string, unknown> => ({ type: 'local', command: node, args: [main, 'mcp'], tools: ['*'] });

const estListeDeChaines = (v: unknown): v is string[] => Array.isArray(v) && v.every((a) => typeof a === 'string');

/** Le fichier lu : sa racine, s'il porte des commentaires ou des virgules finales (`jsonc`), et la déclaration `mnemo` (null : absente). */
export type ConfigMcpLue = { racine: Record<string, unknown>; jsonc: boolean; declaration: DeclarationCopilotCli | null };

/** `mcp-config.json` lu (texte ; null : absent), ou pourquoi Mnemo ne le lit pas. */
export function declarationDansConfig(texte: string | null): ConfigMcpLue | { echec: string } {
	if (texte === null) return { racine: {}, jsonc: false, declaration: null };
	const lu = lireJsonc(texte);
	if ('echec' in lu) return lu;
	if (!estObjet(lu.valeur)) return { echec: 'la racine n’est pas un objet JSON' };
	const serveurs = lu.valeur['mcpServers'];
	if (serveurs !== undefined && !estObjet(serveurs)) return { echec: '« mcpServers » n’est pas un objet JSON' };
	const brut = serveurs?.['mnemo'];
	if (brut === undefined) return { racine: lu.valeur, jsonc: lu.jsonc, declaration: null };
	if (!estObjet(brut)) return { racine: lu.valeur, jsonc: lu.jsonc, declaration: { lancement: null, reglages: ['mnemo'] } };
	const reglages = Object.keys(brut).filter((cle) => !CLES_DE_MNEMO.has(cle));
	if (brut['tools'] !== undefined && JSON.stringify(brut['tools']) !== '["*"]') reglages.push('tools');
	const local = brut['type'] === undefined || brut['type'] === 'local' || brut['type'] === 'stdio';
	const args = brut['args'] === undefined ? [] : estListeDeChaines(brut['args']) ? brut['args'] : null;
	const lancement = local && typeof brut['command'] === 'string' && args !== null ? { commande: brut['command'], args } : null;
	return { racine: lu.valeur, jsonc: lu.jsonc, declaration: { lancement, reglages } };
}

/**
 * Le texte de `mcp-config.json` avec la déclaration de Mnemo (`mcpServers.mnemo`, à sa place ou ajoutée à la fin) ou sans
 * elle (`node` null) ; tout le reste gardé (autres serveurs, leurs champs, clés inconnues), dans le style du fichier
 * (indentation, fins de ligne). Un `mcpServers` vidé reste (vide).
 */
export function texteAvecDeclaration(texte: string | null, racine: Record<string, unknown>, declaration: { node: string; main: string } | null): string {
	const serveurs = { ...(estObjet(racine['mcpServers']) ? racine['mcpServers'] : {}) };
	if (declaration === null) delete serveurs['mnemo'];
	else serveurs['mnemo'] = entreeDeDeclaration(declaration.node, declaration.main);
	return texteJson({ ...racine, mcpServers: serveurs }, styleJson(texte));
}

/**
 * Le serveur `mnemo` est désactivé chez Copilot : nommé dans `disabledMcpServers` de `settings.json` (texte ; null : absent),
 * où `copilot mcp disable` l'écrit (mesuré). Illisible : tenu pour actif.
 */
export function desactiveDansReglages(texte: string | null): boolean {
	const lu = texte === null ? null : lireJsonc(texte);
	if (lu === null || 'echec' in lu || !estObjet(lu.valeur)) return false;
	const desactives = lu.valeur['disabledMcpServers'];
	return Array.isArray(desactives) && desactives.includes('mnemo');
}

/**
 * Commande à copier-coller (chemins cités pour POSIX ou PowerShell) : `copilot mcp add`, qui réécrit tout `mcp-config.json`
 * (commentaires et champs inconnus des autres serveurs perdus, mesuré) ; Mnemo, lui, n'y écrit que son entrée.
 */
export function commandeManuelleCopilotCli(node: string, main: string, plateforme: string): string {
	const citer = plateforme === 'win32' ? citerPowerShell : citerPosix;
	return `copilot mcp add mnemo -- ${citer(node)} ${citer(main)} mcp`;
}

/** L'entrée à mettre à la main dans `mcpServers` de `mcp-config.json`, les autres réglages gardés. */
export const entreeAColler = (node: string, main: string): string => `"mnemo": ${JSON.stringify(entreeDeDeclaration(node, main))}`;
