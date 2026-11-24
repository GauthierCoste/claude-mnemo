import { migrerFormat } from '../../application/migrer-format.ts';
import { dependancesReelles } from '../../infra/systeme.ts';
import { AUCUNE_MEMOIRE, ErreurCli } from './erreurs.ts';
import { trouverRacine } from './racine.ts';

/** `mnemo migrer` : migration ponctuelle de l'ancien format (« Synthèse : », `type_origine`), en un commit ; idempotente. */
export async function commandeMigrer(args: string[]): Promise<void> {
	if (args.length > 0) throw new ErreurCli('Usage : mnemo migrer', 2);
	const racine = trouverRacine(process.cwd());
	if (racine === null) throw new ErreurCli(AUCUNE_MEMOIRE);
	const dependances = dependancesReelles(racine);
	try {
		const { fiches, commit, avertissements } = await migrerFormat(dependances);
		if (commit === null) console.log('Rien à migrer : la mémoire est déjà au format courant.');
		else console.log(`${fiches.length} fiche${fiches.length > 1 ? 's' : ''} migrée${fiches.length > 1 ? 's' : ''} (commit ${commit}).`);
		for (const a of avertissements ?? []) console.log(`avertissement : ${a}`);
	} finally {
		dependances.index.fermer();
	}
}
