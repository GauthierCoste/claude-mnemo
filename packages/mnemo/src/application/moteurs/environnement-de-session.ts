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
export function variablesDeSession(moteur: IdMoteur, session: Pick<Session, 'id' | 'projet'>, profil: Pick<Profil, 'hooks'>, racine: string): Record<string, string> {
	return { MNEMO_SESSION: session.id, MNEMO_MOTEUR: moteur, MNEMO_PROJET: session.projet, MNEMO_RACINE: racine, MNEMO_HOOKS: texteDesHooks(profil.hooks) };
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
