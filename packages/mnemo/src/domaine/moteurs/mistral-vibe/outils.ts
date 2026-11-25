import { ligneDeCommande } from '../ligne-de-commande.ts';
import type { OutilsDuMoteur } from '../moteur.ts';

/**
 * Outils de Mistral Vibe tels que ses hooks les nomment (Vibe 3.1.5, nom qualifié `<groupe>.<outil>`, mesuré) :
 * - commande, visée par `commandes_interdites` : `file_system.bash` avec `{ command }` (mesuré) ; `process.start` avec
 *   `{ command, cwd?, env? }` (déclaration lue, appel non vu) ; `process.write` (saisie envoyée à un processus lancé par
 *   `process.start`, non vu) ne se lit pas comme une commande : refusé s'il y a des commandes interdites, permis sinon ;
 * - écriture, visée par `chemins_interdits` : tout outil `file_system.*` qui porte un chemin (`file_path` : Vibe renomme
 *   pour ses hooks le `path` que le modèle donne, lu et refus mesuré pour `write_file` et `edit` ; `path` accepté aussi),
 *   sauf les lectures connues ; `write_file` et `edit` sans chemin lisible : illisibles ;
 * - outils MCP `mcp_mnemo.<outil>` (mesuré), appelés par le modèle depuis `run_typescript` : chacun déclenche ses hooks
 *   sous son propre nom.
 */
const OUTILS_COMMANDE = new Set(['file_system.bash', 'process.start']);
const SAISIE_DE_PROCESSUS = 'process.write';
const GROUPE_FICHIERS = 'file_system.';
/** Écritures connues, qui portent toujours un chemin. */
const ECRITURES = new Set(['file_system.write_file', 'file_system.edit']);
/** Lectures connues (et l'outil de commande, vérifié comme commande) : jamais des écritures. */
const NON_ECRITURES = new Set(['file_system.read_file', 'file_system.grep', 'file_system.list', 'file_system.glob', 'file_system.ls', 'file_system.search', 'file_system.bash']);

/** Outils du serveur MCP `mnemo` chez Mistral Vibe : `mcp_<serveur>.<outil>`. */
const PREFIXE_MCP = 'mcp_mnemo.';

/**
 * Outils après lesquels un fichier ou une fiche est lu ou écrit (`re:` : expression entière, sans casse, la forme d'un `match`
 * de Vibe). Pas de `match` sur `post_tool` : il est installé pour tous les outils (il efface le dialogue ouvert).
 */
const MOTIF_APRES_OUTIL = 're:file_system\\.(?:write_file|edit)|mcp_mnemo\\..+';

export const OUTILS_MISTRAL_VIBE: OutilsDuMoteur = {
	cheminsEcrits(action) {
		if (!action.nom.startsWith(GROUPE_FICHIERS) || NON_ECRITURES.has(action.nom)) return null;
		const chemin = action.entree['file_path'] ?? action.entree['path'];
		if (typeof chemin === 'string' && chemin !== '') return [chemin];
		// une écriture connue sans chemin lisible : refusée s'il y a des chemins interdits ; un autre outil sans chemin : rien
		return ECRITURES.has(action.nom) || chemin !== undefined ? 'illisible' : null;
	},
	commande(action) {
		if (action.nom === SAISIE_DE_PROCESSUS) return { illisible: true };
		if (!OUTILS_COMMANDE.has(action.nom)) return null;
		return ligneDeCommande(action.entree['command']) ?? '';
	},
	prefixeMcp: PREFIXE_MCP,
	motifApresOutil: MOTIF_APRES_OUTIL,
};
