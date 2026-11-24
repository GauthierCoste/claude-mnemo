import { cheminValide } from '../../domaine/chemin.ts';
import { lireFiche } from '../../domaine/fiche.ts';
import { masquerSecrets } from '../../domaine/secrets.ts';
import { dependancesReelles } from '../../infra/systeme.ts';
import { AUCUNE_MEMOIRE, ErreurCli } from './erreurs.ts';
import { trouverRacine } from './racine.ts';
import { DOSSIER_MEMOIRE } from '../../domaine/dossier-memoire.ts';

/** Affiche la fiche telle qu'elle est stockée. */
export async function commandeLit(args: string[]): Promise<void> {
	if (args.length !== 1) throw new ErreurCli('Usage : mnemo lit <chemin>', 2);
	const racine = trouverRacine(process.cwd());
	if (racine === null) throw new ErreurCli(AUCUNE_MEMOIRE);
	const brut = args[0]!;
	const chemin = cheminValide(brut);
	if (chemin === null) throw new ErreurCli(`Chemin invalide : « ${brut} » (relatif à ${DOSSIER_MEMOIRE}/, séparé par « / »).`);
	const dependances = dependancesReelles(racine);
	const texte = await dependances.coffre.lire(chemin).finally(() => dependances.index.fermer());
	if (texte === null) throw new ErreurCli(`La fiche ${chemin} n'existe pas.`);
	const sortie = estFicheSource(chemin, texte) ? masquerSecrets(texte).texte : texte;
	process.stdout.write(sortie.endsWith('\n') ? sortie : `${sortie}\n`);
}

/** Une fiche `source` recopie son document : ses secrets ne s'affichent jamais (même écrits avant qu'ils soient masqués). */
function estFicheSource(chemin: string, texte: string): boolean {
	try {
		return lireFiche(chemin, texte).type === 'source';
	} catch {
		return false;
	}
}
