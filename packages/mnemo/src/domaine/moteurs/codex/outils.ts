import { citerPosix } from '../../citer.ts';
import type { ActionOutil } from '../../regles-verifiees.ts';
import type { OutilsDuMoteur } from '../moteur.ts';

/**
 * Outils de commande de Codex, visés par `commandes_interdites` : `Bash` (lot 0) et les noms que Codex donne à son outil shell
 * selon le mode (`shell`, `exec_command`, `local_shell` ; à confirmer par un hook espion au lot 5).
 */
const OUTILS_COMMANDE = new Set(['Bash', 'shell', 'exec_command', 'local_shell']);

/** Outil d'écriture de Codex : un patch (`*** Begin Patch` …), visé par `chemins_interdits`. */
const OUTIL_PATCH = 'apply_patch';

/** Outils du serveur MCP `mnemo` chez Codex : `mcp__<serveur>__<outil>`, comme chez Claude Code (lot 0). */
const PREFIXE_MCP = 'mcp__mnemo__';

/** Outils après lesquels Mnemo note ce que Codex a écrit ou lu : un patch, une fiche lue ou écrite par Mnemo. */
const MOTIF_APRES_OUTIL = 'apply_patch|mcp__mnemo__.*';

/** En-têtes d'un patch qui nomment un fichier écrit (ajouté, modifié, supprimé, destination d'un déplacement), lus avec tolérance. */
const EN_TETE = /^\s*\*\*\*\s*(?:add file|update file|delete file|move to)\s*:\s*(.*?)\s*$/iu;

/** Chemins nommés par les en-têtes du patch, dans l'ordre, sans doublon ni chemin vide. */
export function cheminsDuPatch(patch: string): string[] {
	const chemins: string[] = [];
	for (const ligne of patch.split(/\r?\n/u)) {
		const chemin = EN_TETE.exec(ligne)?.[1];
		if (chemin !== undefined && chemin !== '' && !chemins.includes(chemin)) chemins.push(chemin);
	}
	return chemins;
}

/** Shells dont `-c` / `-lc` porte une ligne de commande : `sh`, `bash`, `zsh`, ou leur chemin. */
const SHELL = /(?:^|[\\/])(?:sh|bash|zsh)(?:\.exe)?$/iu;
/** Un argument qui se lit tel quel dans une ligne de commande POSIX. */
const MOT_SIMPLE = /^[A-Za-z0-9_\-./=:,+@%]+$/u;

/**
 * Ligne de commande d'une entrée `command` (ou `cmd`) : une chaîne telle quelle ; une liste `[<shell>, -c | -lc, …, <ligne>]`
 * rend sa dernière ligne ; toute autre liste, ses éléments cités au besoin puis joints. null : aucune des deux formes.
 */
function ligneDeCommande(brut: unknown): string | null {
	if (typeof brut === 'string') return brut;
	if (!Array.isArray(brut) || !brut.every((a): a is string => typeof a === 'string')) return null;
	if (brut.length >= 3 && SHELL.test(brut[0]!) && (brut[1] === '-c' || brut[1] === '-lc')) return brut[brut.length - 1]!;
	return brut.map((a) => (MOT_SIMPLE.test(a) ? a : citerPosix(a))).join(' ');
}

/** Commande de l'action d'un outil de commande (`command`, sinon `cmd`) ; « » si elle n'en porte pas. */
function commandeDe(action: ActionOutil): string {
	return ligneDeCommande(action.entree['command']) ?? ligneDeCommande(action.entree['cmd']) ?? '';
}

/** Texte du patch d'`apply_patch` : `command` (chaîne ou liste), `input` ou `patch` ; null s'il n'y en a pas. */
function texteDuPatch(action: ActionOutil): string | null {
	for (const cle of ['command', 'input', 'patch']) {
		const brut = action.entree[cle];
		if (typeof brut === 'string' && brut.trim() !== '') return brut;
		if (Array.isArray(brut) && brut.length > 0 && brut.every((a) => typeof a === 'string')) return brut.join('\n');
	}
	return null;
}

/**
 * Outils de Codex tels que ses hooks les nomment (lot 0) : `Bash` avec `{ command }` ; `apply_patch` avec `{ command: "***
 * Begin Patch\n*** Add File: <chemin>…" }`, dont les en-têtes donnent les chemins écrits ; outils MCP `mcp__mnemo__<outil>`.
 * Un patch introuvable ou sans en-tête lisible est `illisible` (refusé s'il y a des chemins interdits) ; une commande qui
 * passe un patch à `apply_patch` (heredoc) écrit aussi les chemins de ses en-têtes.
 */
export const OUTILS_CODEX: OutilsDuMoteur = {
	cheminsEcrits(action) {
		if (action.nom === OUTIL_PATCH) {
			const patch = texteDuPatch(action);
			if (patch === null) return 'illisible';
			const chemins = cheminsDuPatch(patch);
			return chemins.length === 0 && /\S/u.test(patch.replace(/^\s*\*\*\*\s*(?:begin|end) patch\s*$/gimu, '')) ? 'illisible' : chemins;
		}
		if (!OUTILS_COMMANDE.has(action.nom)) return null;
		const commande = commandeDe(action);
		if (!/apply_patch/u.test(commande) || !/\*\*\*\s*begin patch/iu.test(commande)) return null;
		const chemins = cheminsDuPatch(commande);
		return chemins.length === 0 ? 'illisible' : chemins;
	},
	commande(action) {
		if (!OUTILS_COMMANDE.has(action.nom)) return null;
		return commandeDe(action);
	},
	prefixeMcp: PREFIXE_MCP,
	motifApresOutil: MOTIF_APRES_OUTIL,
};
