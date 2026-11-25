import { execFile } from 'node:child_process';
import type { CommandeMoteur, Executer } from '../../../application/ports.ts';
import { environnementPermisCodex } from '../../../application/moteurs/codex/session.ts';
import { versionDeCodex } from '../../../domaine/moteurs/codex/version.ts';

/** Délai de `codex --version`. */
export const DELAI_VERSION_MS = 5000;
const GARDE_MS = 10 * 60_000;

/** Exécuteur minimal (sans shell) : code et sorties ; rejette si le programme ne se lance pas ou dépasse le délai. */
const executerSansShell: Executer = (commande, args, options = {}) =>
	new Promise((resoudre, rejeter) => {
		const enfant = execFile(commande, args, { timeout: options.delaiMs ?? DELAI_VERSION_MS, windowsHide: true, ...(options.env === undefined ? {} : { env: options.env }) }, (erreur, sortie, erreurSortie) => {
			if (erreur === null) resoudre({ code: 0, sortie, erreur: erreurSortie });
			else if (typeof erreur.code === 'number') resoudre({ code: erreur.code, sortie, erreur: erreurSortie });
			else rejeter(erreur);
		});
		enfant.stdin?.end();
	});

/**
 * Version de Codex lue par `codex --version` (sous `DELAI_VERSION_MS`, l'environnement des sessions), gardée en cache par
 * commande ; null : illisible, en échec ou trop lente (rien n'est alors empêché). `maintenant` : tests.
 */
export function versionCodex(maintenant: () => number = Date.now): (commande: CommandeMoteur, env: Record<string, string | undefined>, executer?: Executer) => Promise<string | null> {
	const cache = new Map<string, { jusquaMs: number; version: Promise<string | null> }>();
	return (commande, env, executer = executerSansShell) => {
		const cle = JSON.stringify([commande.commande, commande.avant]);
		const garde = cache.get(cle);
		if (garde !== undefined && garde.jusquaMs > maintenant()) return garde.version;
		const version = executer(commande.commande, [...commande.avant, '--version'], { env: environnementPermisCodex(env), delaiMs: DELAI_VERSION_MS })
			.then((r) => (r.code === 0 ? versionDeCodex(r.sortie) : null))
			.catch(() => null);
		cache.set(cle, { jusquaMs: maintenant() + GARDE_MS, version });
		return version;
	};
}
