import type { OutilsDuMoteur } from '../moteur.ts';

/** Outils d'écriture de Claude Code visés par `chemins_interdits`, et le champ qui porte leur chemin. */
const CHAMP_DE_CHEMIN: Readonly<Record<string, string>> = { Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };

/** Outil de commande de Claude Code, visé par `commandes_interdites`. */
const OUTIL_COMMANDE = 'Bash';

/** Outils du serveur MCP `mnemo` chez Claude Code : `mcp__<serveur>__<outil>`. */
export const PREFIXE_MCP = 'mcp__mnemo__';

/** Outils après lesquels Mnemo note ce que Claude a lu ou écrit : un fichier, une fiche lue ou écrite par Mnemo (rien n'est injecté). */
const MATCHER_APRES_OUTIL = 'Read|Edit|MultiEdit|Write|NotebookEdit|mcp__mnemo__.*';

export const OUTILS_CLAUDE_CODE: OutilsDuMoteur = {
	cheminsEcrits(action) {
		if (!Object.hasOwn(CHAMP_DE_CHEMIN, action.nom)) return null;
		const brut = action.entree[CHAMP_DE_CHEMIN[action.nom]!];
		return typeof brut === 'string' && brut !== '' ? [brut] : [];
	},
	commande(action) {
		if (action.nom !== OUTIL_COMMANDE) return null;
		const commande = action.entree['command'];
		return typeof commande === 'string' ? commande : '';
	},
	prefixeMcp: PREFIXE_MCP,
	motifApresOutil: MATCHER_APRES_OUTIL,
};
