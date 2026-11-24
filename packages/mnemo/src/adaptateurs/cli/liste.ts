import { lister } from '../../application/lister.ts';
import { dependancesReelles } from '../../infra/systeme.ts';
import { AUCUNE_MEMOIRE, ErreurCli } from './erreurs.ts';
import { trouverRacine } from './racine.ts';

export async function commandeListe(args: string[]): Promise<void> {
	if (args.length > 1) throw new ErreurCli('Usage : mnemo liste [dossier]', 2);
	const racine = trouverRacine(process.cwd());
	if (racine === null) throw new ErreurCli(AUCUNE_MEMOIRE);
	const dependances = dependancesReelles(racine);
	const listing = await lister(dependances, args[0] ?? '').finally(() => dependances.index.fermer());
	if (listing.ficheDossier === null && listing.fiches.length === 0 && listing.sousDossiers.length === 0) {
		console.log(`Dossier vide ou inconnu : ${args[0] ?? ''}`);
		return;
	}
	const sortie: string[] = [];
	if (listing.ficheDossier !== null) {
		sortie.push(listing.ficheDossier.titre);
		if (listing.ficheDossier.synthese !== '') sortie.push(listing.ficheDossier.synthese);
		sortie.push('');
	}
	for (const f of listing.fiches) sortie.push(`  ${f.titre}  (${f.type})  ${f.chemin}`);
	for (const d of listing.sousDossiers) sortie.push(`  ${d}/`);
	console.log(sortie.join('\n'));
}
