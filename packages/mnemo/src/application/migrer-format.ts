import { migrerTexteDeFiche } from '../domaine/migration-format.ts';
import { ecrireEtCommiter, sousVerrou } from './commun.ts';
import type { Dependances } from './ports.ts';
import { reindexerApresEcriture } from './synchroniser.ts';

export type BilanMigration = { fiches: string[]; commit: string | null; avertissements?: string[] };

/**
 * Migration ponctuelle de l'ancien format : retire « Synthèse : » en tête de synthèse et `type_origine` des en-têtes, en
 * un seul commit `mnemo: migre format ancien (<n> fiches)`, puis réindexe. Idempotente : rien à migrer, rien d'écrit, aucun
 * commit. Les fiches sont lues et réécrites telles quelles hors ces deux retraits.
 */
export async function migrerFormat(dep: Dependances): Promise<BilanMigration> {
	const bilan = await sousVerrou<BilanMigration>(dep, async () => {
		const aEcrire: { chemin: string; texte: string }[] = [];
		for (const chemin of await dep.coffre.toutesLesFiches()) {
			const texte = await dep.coffre.lire(chemin);
			if (texte === null) continue;
			const neuf = migrerTexteDeFiche(texte);
			if (neuf !== texte) aEcrire.push({ chemin, texte: neuf });
		}
		if (aEcrire.length === 0) return { fiches: [], commit: null };
		const commit = await ecrireEtCommiter(dep, aEcrire, `mnemo: migre format ancien (${aEcrire.length} fiche${aEcrire.length > 1 ? 's' : ''})`);
		return { fiches: aEcrire.map((f) => f.chemin), commit };
	});
	if (bilan.commit === null) return bilan;
	const { avertissements } = await reindexerApresEcriture(dep);
	return avertissements === undefined ? bilan : { ...bilan, avertissements };
}
