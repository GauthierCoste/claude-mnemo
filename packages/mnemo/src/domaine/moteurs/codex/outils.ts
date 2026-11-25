import type { OutilsDuMoteur } from '../moteur.ts';

/** Outil de commande de Codex (`{ command }`), visé par `commandes_interdites`. */
const OUTIL_COMMANDE = 'Bash';

/** Outil d'écriture de Codex : un patch dans `command` (`*** Begin Patch` …), visé par `chemins_interdits`. */
const OUTIL_PATCH = 'apply_patch';

/** Outils du serveur MCP `mnemo` chez Codex : `mcp__<serveur>__<outil>`, comme chez Claude Code (lot 0). */
const PREFIXE_MCP = 'mcp__mnemo__';

/** Outils après lesquels Mnemo note ce que Codex a écrit ou lu : un patch, une fiche lue ou écrite par Mnemo. */
const MOTIF_APRES_OUTIL = 'apply_patch|mcp__mnemo__.*';

/** En-têtes d'un patch qui nomment un fichier écrit : ajouté, modifié, supprimé, ou destination d'un déplacement. */
const EN_TETE = /^\*\*\* (?:Add File|Update File|Delete File|Move to):[ \t]*(.*?)[ \t]*$/u;

/** Chemins nommés par les en-têtes du patch, dans l'ordre, sans doublon ni chemin vide. */
export function cheminsDuPatch(patch: string): string[] {
	const chemins: string[] = [];
	for (const ligne of patch.split(/\r?\n/u)) {
		const chemin = EN_TETE.exec(ligne)?.[1];
		if (chemin !== undefined && chemin !== '' && !chemins.includes(chemin)) chemins.push(chemin);
	}
	return chemins;
}

/** `command` de l'outil : une chaîne, ou une liste d'arguments rejoints par des espaces (« » sinon). */
function texteDeCommande(brut: unknown): string {
	if (typeof brut === 'string') return brut;
	if (Array.isArray(brut) && brut.every((a) => typeof a === 'string')) return brut.join(' ');
	return '';
}

/**
 * Outils de Codex tels que ses hooks les nomment (lot 0) : `Bash` avec `{ command }` ; `apply_patch` avec `{ command: "***
 * Begin Patch\n*** Add File: <chemin>…" }`, dont les en-têtes donnent les chemins écrits ; outils MCP `mcp__mnemo__<outil>`.
 */
export const OUTILS_CODEX: OutilsDuMoteur = {
	cheminsEcrits(action) {
		if (action.nom !== OUTIL_PATCH) return null;
		return cheminsDuPatch(texteDeCommande(action.entree['command']));
	},
	commande(action) {
		if (action.nom !== OUTIL_COMMANDE) return null;
		return texteDeCommande(action.entree['command']);
	},
	prefixeMcp: PREFIXE_MCP,
	motifApresOutil: MOTIF_APRES_OUTIL,
};
