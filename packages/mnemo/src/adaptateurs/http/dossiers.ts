/** État git d'un dossier de la racine pour l'interface (panneau Dossier), gardé quelques secondes. */
import type { GitDossierVue } from '@mnemo/contrat';
import { FICHIERS_GIT_MAX } from '@mnemo/commun';
import type { Depot } from '../../application/ports.ts';

export const GARDE_GIT_MS = 10_000;

/**
 * État git d'un dossier (déjà validé), gardé `GARDE_GIT_MS` par dossier et par étendue ; un échec n'est pas gardé. `tout` :
 * tous les fichiers modifiés, sinon `FICHIERS_GIT_MAX` au plus ; `modifies` est toujours le vrai total.
 */
export function etatsGit(depot: Depot, maintenant: () => number = Date.now): (dossier: string, tout: boolean) => Promise<GitDossierVue> {
	const gardes = new Map<string, { jusqua: number; vue: Promise<GitDossierVue> }>();
	const lire = async (dossier: string, tout: boolean): Promise<GitDossierVue> => {
		const etat = await depot.etat(dossier);
		if (etat === null) return null;
		const statuts = (await depot.statuts(dossier, tout ? Number.POSITIVE_INFINITY : FICHIERS_GIT_MAX)) ?? { fichiers: [], total: 0 };
		return { branche: etat.branche, fichiers: statuts.fichiers, modifies: statuts.total };
	};
	return (dossier, tout) => {
		const t = maintenant();
		for (const [cle, g] of gardes) if (g.jusqua <= t) gardes.delete(cle);
		const cle = JSON.stringify([dossier, tout]);
		const garde = gardes.get(cle);
		if (garde !== undefined) return garde.vue;
		const vue = lire(dossier, tout);
		gardes.set(cle, { jusqua: t + GARDE_GIT_MS, vue });
		vue.catch(() => gardes.delete(cle));
		return vue;
	};
}
