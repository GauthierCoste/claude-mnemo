import type { ActionOutil } from '../../regles-verifiees.ts';
import { ligneDeCommande } from '../ligne-de-commande.ts';
import type { OutilsDuMoteur } from '../moteur.ts';
import { cheminsEcritsDuPatch } from '../patch.ts';

/**
 * Outils de GitHub Copilot CLI tels que ses hooks les nomment (1.0.116, `toolName` et `toolArgs`, un objet sauf pour
 * `apply_patch` ; mesuré) :
 * - commande, visée par `commandes_interdites` : `bash` avec `{ command, description }` (mesuré), `powershell` sous Windows
 *   (lu, non mesuré) ; `write_bash` et `write_powershell` (saisie envoyée à un shell déjà lancé, non vus) ne se lisent pas
 *   comme une commande : refusés s'il y a des commandes interdites, permis sinon ;
 * - écriture, visée par `chemins_interdits` : `create` et `edit` avec `{ path }` (mesuré, chemin absolu),
 *   `str_replace_editor` avec `{ command, path }` (lu dans le code, jamais vu ; `view` est une lecture), `apply_patch` (modèles
 *   gpt-* : le patch en chaîne, gardé sous `input`, dont les en-têtes donnent les chemins ; mesuré) ; tout autre outil de
 *   Copilot qui porte un chemin (`path`, `file_path`), sauf les lectures connues, compte comme une écriture ; une écriture
 *   connue sans chemin lisible est illisible ;
 * - outils MCP `mnemo-<outil>` (mesuré : `<serveur>-<outil>` pour le modèle et les hooks).
 */
const OUTILS_COMMANDE = new Set(['bash', 'powershell']);
const SAISIES_DE_SHELL = new Set(['write_bash', 'write_powershell']);
const OUTIL_PATCH = 'apply_patch';
/** Écritures connues, qui portent toujours un chemin. */
const ECRITURES = new Set(['create', 'edit', 'str_replace_editor']);
/** Lectures connues (et les outils de commande, vérifiés comme commandes) : jamais des écritures. */
const NON_ECRITURES = new Set(['view', 'grep', 'glob', 'rg', 'read_bash', 'list_bash', 'stop_bash', 'read_powershell', 'list_powershell', 'stop_powershell', 'bash', 'powershell']);
/** Sous-commande de `str_replace_editor` qui ne fait que lire. */
const LECTURE_DE_L_EDITEUR = 'view';

/** Outils du serveur MCP `mnemo` chez GitHub Copilot CLI : `<serveur>-<outil>`. */
const PREFIXE_MCP = 'mnemo-';

/**
 * Outils après lesquels un fichier ou une fiche est lu ou écrit (expression rationnelle qui couvre tout le nom). Pas de
 * `matcher` chez Copilot : son `postToolUse` est installé pour tous les outils (il efface le dialogue ouvert).
 */
const MOTIF_APRES_OUTIL = 'create|edit|str_replace_editor|apply_patch|mnemo-.+';

/** Un outil de Copilot lui-même (ni MCP `<serveur>-<outil>`) : ses noms n'ont pas de tiret. */
const estOutilDeCopilot = (nom: string): boolean => /^[a-z][a-z0-9_]*$/u.test(nom);

/** Chemin que porte l'action (`path`, sinon `file_path`) ; undefined s'il n'y en a pas. */
const cheminDe = (action: ActionOutil): unknown => action.entree['path'] ?? action.entree['file_path'];

export const OUTILS_COPILOT_CLI: OutilsDuMoteur = {
	cheminsEcrits(action) {
		if (action.nom === OUTIL_PATCH) {
			const patch = action.entree['input'];
			return cheminsEcritsDuPatch(typeof patch === 'string' && patch.trim() !== '' ? patch : null);
		}
		if (!estOutilDeCopilot(action.nom) || NON_ECRITURES.has(action.nom)) return null;
		if (action.nom === 'str_replace_editor' && action.entree['command'] === LECTURE_DE_L_EDITEUR) return null;
		const chemin = cheminDe(action);
		if (typeof chemin === 'string' && chemin !== '') return [chemin];
		// une écriture connue sans chemin lisible : refusée s'il y a des chemins interdits ; un autre outil sans chemin : rien
		return ECRITURES.has(action.nom) || chemin !== undefined ? 'illisible' : null;
	},
	commande(action) {
		if (SAISIES_DE_SHELL.has(action.nom)) return { illisible: true };
		if (!OUTILS_COMMANDE.has(action.nom)) return null;
		return ligneDeCommande(action.entree['command']) ?? '';
	},
	prefixeMcp: PREFIXE_MCP,
	motifApresOutil: MOTIF_APRES_OUTIL,
};
