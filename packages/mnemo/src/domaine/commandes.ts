/**
 * Commandes de `mnemo` (premier argument). Tout autre premier argument est un dossier : le service de ce dossier. Module sans
 * effet de bord : `cli/main.ts` l'importe pour aiguiller, `infra/verrou-service.ts` pour reconnaître la ligne de commande
 * d'un service.
 */
export const COMMANDES_CLI: readonly string[] = [
	'--aide',
	'-h',
	'aide',
	'init',
	'verifier-poste',
	'lit',
	'liste',
	'cherche',
	'index',
	'migrer',
	'source',
	'amorce',
	'modeles',
	'banc',
	'jeton',
	'ouvrir',
	'arreter',
	'lanceur',
	'commande',
	'mcp',
	'hook',
	'ligne-etat',
	'sessions',
	'session',
];
