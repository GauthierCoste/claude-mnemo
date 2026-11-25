import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { DOSSIER_LOCAL } from '../../domaine/dossier-memoire.ts';
import { arreterServeurs, cheminsModeles, lireLances, MOTIF_FICHIER_CLE, pidVivant } from './serveurs.ts';
import type { ResultatArret } from './serveurs.ts';

/** Temporaire d'écriture laissé par une écriture interrompue (`modeles.json.tmp-<hasard>`, idem pour le registre). */
const MOTIF_TEMPORAIRE = /^modeles(-lances)?\.json\.tmp-/u;

/** Fichiers de l'ancien état présents dans `local` (`.mnemo/` d'un dossier), chemins absolus. */
async function fichiersAnciens(local: string): Promise<string[]> {
	const anciens = cheminsModeles(local);
	const fixes = new Set([anciens.etat, anciens.lances, anciens.verrou, `${anciens.verrou}.lock`, anciens.actif, anciens.journal].map((f) => basename(f)));
	const noms = await readdir(local).catch(() => [] as string[]);
	return noms.filter((n) => fixes.has(n) || MOTIF_TEMPORAIRE.test(n) || MOTIF_FICHIER_CLE.test(n)).map((n) => join(local, n));
}

/**
 * Migration, à retirer un jour : jusqu'à la 1.5, chaque dossier Mnemo avait son gardien, avec son état dans
 * `<racine>/.mnemo/` (`modeles.json`, `modeles-lances.json`, verrou, `modeles.actif`, `modeles.log`, fichiers `.cle`,
 * temporaires d'écriture). Les noms de fichiers n'ont pas changé : l'ancien gardien et ses serveurs sont arrêtés par le code
 * d'arrêt d'aujourd'hui, avec la même prudence (seuls les processus prouvés nôtres, clé vérifiée), puis ces fichiers sont
 * retirés. Des serveurs qui chargent encore (pas vérifiables) gardent leurs fichiers, et un registre dont une entrée vit
 * encore (réécrit par l'ancien gardien pendant son arrêt) est gardé : la prochaine migration les reprendra.
 * Sans état ni registre (un journal, une date d'activité ou un temporaire seuls), rien n'est à arrêter : les restes sont
 * retirés (`rien`).
 *
 * Rend null s'il n'y avait aucun fichier de l'ancien état, sinon le résultat de l'arrêt.
 */
export async function migrerAncienGardien(racine: string, env: NodeJS.ProcessEnv = process.env): Promise<ResultatArret | null> {
	const local = join(racine, DOSSIER_LOCAL);
	if ((await fichiersAnciens(local)).length === 0) return null;
	const anciens = cheminsModeles(local);
	const resultat = existsSync(anciens.etat) || existsSync(anciens.lances) ? await arreterServeurs(local, env) : 'rien';
	if (typeof resultat === 'object') return resultat;
	await retirerRestes(local);
	return resultat;
}

/**
 * Retire les fichiers de l'ancien état de `local` (relus : l'arrêt a pu en écrire, journal, verrou), sauf le registre des
 * serveurs lancés tant qu'une de ses entrées vit encore : le prochain démarrage (migration) les arrêtera.
 */
export async function retirerRestes(local: string): Promise<void> {
	const registre = cheminsModeles(local).lances;
	const vivants = (await lireLances(local)).some((l) => pidVivant(l.pid));
	const aRetirer = (await fichiersAnciens(local)).filter((f) => !(vivants && f === registre));
	await Promise.all(aRetirer.map((f) => rm(f, { recursive: true, force: true })));
}
