import { execFile } from 'node:child_process';
import type { Executer, MoteurDuPoste } from '../../../application/ports.ts';
import { environnementPermisCodex } from '../../../application/moteurs/codex/session.ts';
import { versionDeCodex } from '../../../domaine/moteurs/codex/version.ts';
import { avecDelaiGaranti, MARGE_DELAI_MS } from '../../delai-garanti.ts';

/** Délai de `codex --version`. */
export const DELAI_VERSION_MS = 5000;
/** Une version lue sert ce temps ; illisible (échec, délai), moins longtemps : Codex peut être installé ou réparé entre-temps. */
const GARDE_MS = 10 * 60_000;
const GARDE_ECHEC_MS = 60_000;

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

type EnCache = { jusquaMs: number; version: Promise<string | null> };

/**
 * Version de Codex lue par `codex --version` (sous `DELAI_VERSION_MS`, garanti par un minuteur, l'environnement des
 * sessions), gardée en cache par commande ; null : illisible, en échec ou trop lente (rien n'est alors empêché), gardé
 * une minute seulement. `relire` : sans le cache (Réglages › Système, « Relire »). `maintenant` : tests.
 */
export function versionCodex(maintenant: () => number = Date.now): NonNullable<MoteurDuPoste['version']> {
	const cache = new Map<string, EnCache>();
	return (commande, env, executer = executerSansShell, options = {}) => {
		const cle = JSON.stringify([commande.commande, commande.avant]);
		const garde = cache.get(cle);
		if (options.relire !== true && garde !== undefined && garde.jusquaMs > maintenant()) return garde.version;
		const entree: EnCache = { jusquaMs: maintenant() + GARDE_MS, version: Promise.resolve(null) };
		const lue = executer(commande.commande, [...commande.avant, '--version'], { env: environnementPermisCodex(env), delaiMs: DELAI_VERSION_MS })
			.then((r) => (r.code === 0 ? versionDeCodex(r.sortie) : null))
			.catch(() => null);
		entree.version = avecDelaiGaranti(lue, DELAI_VERSION_MS + MARGE_DELAI_MS, null).then((version) => {
			if (version === null) entree.jusquaMs = Math.min(entree.jusquaMs, maintenant() + GARDE_ECHEC_MS);
			return version;
		});
		cache.set(cle, entree);
		return entree.version;
	};
}
