import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DOSSIER_LOCAL } from '../../domaine/dossier-memoire.ts';
import { arreterServeurs, cheminsModeles, MOTIF_FICHIER_CLE } from './serveurs.ts';
import type { ResultatArret } from './serveurs.ts';

/**
 * Migration, à retirer un jour : jusqu'à la 1.5, chaque dossier Mnemo avait son gardien, avec son état dans
 * `<racine>/.mnemo/` (`modeles.json`, `modeles-lances.json`, verrou, `modeles.actif`, `modeles.log`, fichiers `.cle`). Les
 * noms de fichiers n'ont pas changé : l'ancien gardien et ses serveurs sont arrêtés par le code d'arrêt d'aujourd'hui, avec
 * la même prudence (seuls les processus prouvés nôtres, clé vérifiée), puis ces fichiers sont retirés. Des serveurs qui
 * chargent encore (pas vérifiables) gardent leurs fichiers : la prochaine migration les reprendra.
 *
 * Rend null s'il n'y avait aucun ancien état, sinon le résultat de l'arrêt.
 */
export async function migrerAncienGardien(racine: string, env: NodeJS.ProcessEnv = process.env): Promise<ResultatArret | null> {
	const local = join(racine, DOSSIER_LOCAL);
	const anciens = cheminsModeles(local);
	if (!existsSync(anciens.etat) && !existsSync(anciens.lances)) return null;
	const resultat = await arreterServeurs(local, env);
	if (typeof resultat === 'object') return resultat;
	const cles = await readdir(local).then(
		(noms) => noms.filter((n) => MOTIF_FICHIER_CLE.test(n)).map((n) => join(local, n)),
		() => [],
	);
	await Promise.all([anciens.etat, anciens.lances, anciens.verrou, anciens.actif, anciens.journal, ...cles].map((f) => rm(f, { force: true })));
	return resultat;
}
