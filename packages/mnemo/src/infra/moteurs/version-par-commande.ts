import type { Executer, MoteurDuPoste } from '../../application/ports.ts';
import { versionDans } from '../../domaine/moteurs/version.ts';
import { executeurReel } from '../executeur.ts';
import { lectureEnCache } from './lecture-en-cache.ts';

/** Délai de `<moteur> --version`. */
export const DELAI_VERSION_MS = 5000;

/** Exécuteur réel (sans shell), le délai passé à chaque appel. */
const executerSansShell: Executer = executeurReel();

/**
 * Version d'un moteur lue par `<commande> --version` (sous `DELAI_VERSION_MS`, garanti par un minuteur), dans l'environnement
 * de ses sessions (`envPermis`), gardée en cache 10 minutes par commande ; null : illisible, en échec ou trop lente (rien n'est
 * alors empêché), gardé une minute seulement. `relire` : sans le cache (Réglages › Branchements, « Relire »). `maintenant` : tests.
 */
export function versionParCommande(envPermis: (env: Record<string, string | undefined>) => Record<string, string>, maintenant: () => number = Date.now): NonNullable<MoteurDuPoste['version']> {
	const lire = lectureEnCache<string | null>({ gardeMs: 10 * 60_000, gardeEchecMs: 60_000, delaiMs: DELAI_VERSION_MS, repli: null, estEchec: (v) => v === null, maintenant });
	return (commande, env, executer = executerSansShell, options = {}) =>
		lire(
			JSON.stringify([commande.commande, commande.avant]),
			() => executer(commande.commande, [...commande.avant, '--version'], { env: envPermis(env), delaiMs: DELAI_VERSION_MS }).then((r) => (r.code === 0 ? versionDans(r.sortie) : null)),
			options.relire === true,
		);
}
