import { environnementPermisCodex } from '../../../application/moteurs/codex/session.ts';
import type { AppelModeles } from '../../../application/ports.ts';
import { modelesDuCatalogue } from '../../../domaine/moteurs/codex/modeles.ts';
import { lectureEnCache } from '../lecture-en-cache.ts';

/** Délai de `codex debug models` : la liste n'est qu'indicative, le modèle par défaut reste toujours possible. */
export const DELAI_MODELES_MS = 5000;

/**
 * Modèles de Codex lus par `codex debug models` (catalogue en JSON : visibilité `list`, par priorité), sous `DELAI_MODELES_MS`,
 * gardés en cache 10 minutes par commande et par `CODEX_HOME` (un échec, une minute). Introuvable, en échec ou illisible :
 * aucun (le modèle par défaut de Codex). `maintenant` : tests.
 */
export function modelesCodex(maintenant: () => number = Date.now): (a: AppelModeles) => Promise<readonly string[]> {
	const lire = lectureEnCache<readonly string[]>({ gardeMs: 10 * 60_000, gardeEchecMs: 60_000, delaiMs: DELAI_MODELES_MS, repli: [], estEchec: (m) => m.length === 0, maintenant });
	return (a) => {
		const { commande } = a;
		if (commande === null) return Promise.resolve([]);
		// le même environnement que les sessions : sans les variables interdites à Codex
		const env = environnementPermisCodex(a.env);
		return lire(JSON.stringify([commande.commande, commande.avant, a.env.CODEX_HOME ?? '']), () =>
			a.executer(commande.commande, [...commande.avant, 'debug', 'models'], { env, delaiMs: DELAI_MODELES_MS }).then((r) => (r.code === 0 ? modelesDuCatalogue(r.sortie) : [])),
		);
	};
}
