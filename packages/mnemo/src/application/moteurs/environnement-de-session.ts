import { texteDesHooks } from '../../domaine/moteurs/hooks-du-profil.ts';
import type { IdMoteur } from '../../domaine/moteurs/moteur.ts';
import type { Profil } from '../../domaine/profil.ts';
import type { Session } from '../../domaine/session.ts';

/**
 * Variables de la session que le serveur MCP `mnemo` lancé par un moteur doit recevoir : un moteur ne transmet à un serveur
 * MCP qu'un petit nombre de variables de son environnement (Codex : `env_vars` ; Mistral Vibe : `env` de la déclaration).
 */
export const VARIABLES_DU_SERVEUR_MCP = ['MNEMO_SESSION', 'MNEMO_MOTEUR', 'MNEMO_PROJET', 'MNEMO_RACINE'] as const;

/**
 * Variables qu'une session Mnemo pose pour un moteur dont les hooks sont installés pour tout le poste : la session (lue par
 * `mnemo hook` et `mnemo mcp`), son moteur (`MNEMO_MOTEUR` : sans lui, ces hooks restent inertes), le projet, la racine, et
 * les hooks que le profil demande (`MNEMO_HOOKS` : ces hooks, communs à toutes les sessions, en tirent ce que le plugin d'une
 * session Claude Code déclare).
 */
export function variablesDeSession(moteur: IdMoteur, session: Pick<Session, 'id' | 'projet'>, profil: Pick<Profil, 'hooks'>, racine: string): Record<(typeof VARIABLES_DU_SERVEUR_MCP)[number] | 'MNEMO_HOOKS', string> {
	return { MNEMO_SESSION: session.id, MNEMO_MOTEUR: moteur, MNEMO_PROJET: session.projet, MNEMO_RACINE: racine, MNEMO_HOOKS: texteDesHooks(profil.hooks) };
}

/**
 * Variables d'un autre fournisseur, qu'un moteur ne reçoit jamais : un jeton ou une clé d'un autre outil n'a rien à faire dans
 * son environnement (il passerait à ses outils, à ses commandes, à ses journaux). `GH_TOKEN` et `GITHUB_TOKEN` restent : ils
 * servent à `gh` et à git dans toute session (leur priorité sur `/login` chez GitHub Copilot CLI reste à mesurer).
 * - `CLAUDECODE`, `CLAUDE_CODE_*` (marques d'une session Claude Code parente, réglages de Claude Code) et `ANTHROPIC_*` :
 *   hors Claude Code (chez lui, `estInterdite` décide ; ce que Mnemo pose est ajouté après le filtre) ;
 * - `CODEX_API_KEY` et `OPENAI_API_KEY` : hors Codex ;
 * - `MISTRAL_API_KEY` : hors Mistral Vibe ;
 * - `COPILOT_GITHUB_TOKEN` : hors GitHub Copilot CLI.
 */
export function estDUnAutreFournisseur(moteur: IdMoteur, majuscules: string): boolean {
	if (majuscules === 'CLAUDECODE' || majuscules.startsWith('CLAUDE_CODE_') || majuscules.startsWith('ANTHROPIC_')) return moteur !== 'claude-code';
	if (majuscules === 'CODEX_API_KEY' || majuscules === 'OPENAI_API_KEY') return moteur !== 'codex';
	if (majuscules === 'MISTRAL_API_KEY') return moteur !== 'mistral-vibe';
	if (majuscules === 'COPILOT_GITHUB_TOKEN') return moteur !== 'copilot-cli';
	return false;
}

/** Règle propre à un moteur (nom en majuscules) : variables qu'il ne reçoit pas en plus de celles d'un autre fournisseur. */
export type RegleDuMoteur = (majuscules: string) => boolean;

/**
 * Une variable que le moteur ne reçoit pas : d'un autre fournisseur (`estDUnAutreFournisseur`) ou interdite par sa propre règle
 * (clé d'API qui prendrait le pas sur l'abonnement…). Nom comparé en majuscules, comme sous Windows.
 */
export function estRetiree(moteur: IdMoteur, cle: string, propre?: RegleDuMoteur): boolean {
	const majuscules = cle.toUpperCase();
	return estDUnAutreFournisseur(moteur, majuscules) || propre?.(majuscules) === true;
}

/** Environnement de l'utilisateur sans les valeurs absentes ni les variables que le moteur ne reçoit pas (`estRetiree`). */
export function environnementPermis(moteur: IdMoteur, env: Record<string, string | undefined>, propre?: RegleDuMoteur): Record<string, string> {
	const resultat: Record<string, string> = {};
	for (const [cle, valeur] of Object.entries(env)) if (valeur !== undefined && !estRetiree(moteur, cle, propre)) resultat[cle] = valeur;
	return resultat;
}

/** Variables présentes chez l'utilisateur que le moteur ne reçoit pas, retirées dans la ligne à coller. */
export function variablesRetirees(moteur: IdMoteur, env: Record<string, string | undefined>, propre?: RegleDuMoteur): string[] {
	return Object.keys(env).filter((cle) => env[cle] !== undefined && estRetiree(moteur, cle, propre));
}

/**
 * Environnement du moteur : `permis` (celui de l'utilisateur, déjà filtré), dont les variables que `ajouts` pose sont retirées
 * sans tenir compte de la casse (comme sous Windows), puis `ajouts`.
 */
export function environnementAvec(permis: Record<string, string>, ajouts: Record<string, string>): Record<string, string> {
	const poses = new Set(Object.keys(ajouts).map((cle) => cle.toUpperCase()));
	const resultat: Record<string, string> = {};
	for (const [cle, valeur] of Object.entries(permis)) if (!poses.has(cle.toUpperCase())) resultat[cle] = valeur;
	return { ...resultat, ...ajouts };
}
