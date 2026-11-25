import { ligneDeCommande } from '../ligne-de-commande.ts';
import type { OutilsDuMoteur } from '../moteur.ts';

/**
 * Outils de Mistral Vibe tels que ses hooks les nomment (Vibe 3.1.5, nom qualifié `<groupe>.<outil>`, mesuré) :
 * - commande, visée par `commandes_interdites` : `file_system.bash` avec `{ command }` (mesuré) ; `process.start` avec
 *   `{ command, cwd?, env? }` (déclaration lue, appel non vu) ;
 * - écriture, visée par `chemins_interdits` : `file_system.write_file` et `file_system.edit` avec `{ file_path }` (Vibe
 *   renomme pour ses hooks le `path` que le modèle donne ; lu, refus mesuré ; `path` accepté aussi) ;
 * - outils MCP `mcp_mnemo.<outil>` (mesuré), appelés par le modèle depuis `run_typescript` : chacun déclenche ses hooks
 *   sous son propre nom.
 */
const OUTILS_COMMANDE = new Set(['file_system.bash', 'process.start']);
const OUTILS_ECRITURE = new Set(['file_system.write_file', 'file_system.edit']);

/** Outils du serveur MCP `mnemo` chez Mistral Vibe : `mcp_<serveur>.<outil>`. */
const PREFIXE_MCP = 'mcp_mnemo.';

/** `match` des hooks `post_tool` de Vibe (`re:` : expression entière, sans casse) : une écriture, une fiche lue ou écrite par Mnemo. */
const MOTIF_APRES_OUTIL = 're:file_system\\.(?:write_file|edit)|mcp_mnemo\\..+';

export const OUTILS_MISTRAL_VIBE: OutilsDuMoteur = {
	cheminsEcrits(action) {
		if (!OUTILS_ECRITURE.has(action.nom)) return null;
		const chemin = action.entree['file_path'] ?? action.entree['path'];
		// un outil d'écriture sans chemin lisible : refusé s'il y a des chemins interdits
		return typeof chemin === 'string' && chemin !== '' ? [chemin] : 'illisible';
	},
	commande(action) {
		if (!OUTILS_COMMANDE.has(action.nom)) return null;
		return ligneDeCommande(action.entree['command']) ?? '';
	},
	prefixeMcp: PREFIXE_MCP,
	motifApresOutil: MOTIF_APRES_OUTIL,
};
