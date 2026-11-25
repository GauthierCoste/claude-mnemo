import { environnementPermisCodex } from '../../../application/moteurs/codex/session.ts';
import type { AppelModeles } from '../../../application/ports.ts';
import { modelesDuCatalogue } from '../../../domaine/moteurs/codex/modeles.ts';

/** Délai de `codex debug models` : la liste n'est qu'indicative, le modèle par défaut reste toujours possible. */
export const DELAI_MODELES_MS = 5000;
/** Une liste lue sert ce temps ; un échec, moins longtemps (Codex peut être installé ou connecté entre-temps). */
const GARDE_MS = 10 * 60_000;
const GARDE_ECHEC_MS = 60_000;

type EnCache = { jusquaMs: number; modeles: Promise<readonly string[]> };

/**
 * Modèles de Codex lus par `codex debug models` (catalogue en JSON : visibilité `list`, par priorité), sous `DELAI_MODELES_MS`,
 * gardés en cache par commande et par `CODEX_HOME`. Introuvable, en échec ou illisible : aucun (le modèle par défaut de
 * Codex). `maintenant` : tests.
 */
export function modelesCodex(maintenant: () => number = Date.now): (a: AppelModeles) => Promise<readonly string[]> {
	const cache = new Map<string, EnCache>();
	return (a) => {
		const { commande } = a;
		if (commande === null) return Promise.resolve([]);
		const cle = JSON.stringify([commande.commande, commande.avant, a.env.CODEX_HOME ?? '']);
		const garde = cache.get(cle);
		if (garde !== undefined && garde.jusquaMs > maintenant()) return garde.modeles;
		// le même environnement que les sessions : sans les variables interdites à Codex
		const env = environnementPermisCodex(a.env);
		const entree: EnCache = { jusquaMs: maintenant() + GARDE_MS, modeles: Promise.resolve([]) };
		entree.modeles = a
			.executer(commande.commande, [...commande.avant, 'debug', 'models'], { env, delaiMs: DELAI_MODELES_MS })
			.then((r) => (r.code === 0 ? modelesDuCatalogue(r.sortie) : []))
			.catch((): string[] => [])
			.then((modeles) => {
				if (modeles.length === 0) entree.jusquaMs = Math.min(entree.jusquaMs, maintenant() + GARDE_ECHEC_MS);
				return modeles;
			});
		cache.set(cle, entree);
		return entree.modeles;
	};
}
