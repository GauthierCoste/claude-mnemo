/**
 * Patch au format `*** Begin Patch` (outil `apply_patch` de Codex, et de GitHub Copilot CLI avec les modèles gpt-*) : ses
 * en-têtes nomment les fichiers écrits.
 */

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

/**
 * Chemins écrits par un patch ; `illisible` : patch introuvable (null), ou qui porte autre chose que ses bornes sans aucun
 * en-tête lisible (refusé s'il y a des chemins interdits). Un patch vide n'écrit rien.
 */
export function cheminsEcritsDuPatch(patch: string | null): string[] | 'illisible' {
	if (patch === null) return 'illisible';
	const chemins = cheminsDuPatch(patch);
	return chemins.length === 0 && /\S/u.test(patch.replace(/^\s*\*\*\*\s*(?:begin|end) patch\s*$/gimu, '')) ? 'illisible' : chemins;
}
