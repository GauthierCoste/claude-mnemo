import type { AppelModeles } from '../../../application/ports.ts';
import { modelesDeLAide } from '../../../domaine/moteurs/copilot-cli/modeles.ts';
import { definies } from '../../../domaine/valeurs.ts';
import { lectureEnCache } from '../lecture-en-cache.ts';

/** Délai de `copilot help config` : la liste n'est qu'indicative, le modèle par défaut reste toujours possible. */
export const DELAI_MODELES_COPILOT_MS = 5000;

/**
 * Modèles de GitHub Copilot CLI lus dans `copilot help config` (sans réseau ni compte, mesuré), sous
 * `DELAI_MODELES_COPILOT_MS`, gardés en cache 10 minutes par commande (un échec, une minute) ; mise à jour automatique coupée
 * pour cet appel (`COPILOT_AUTO_UPDATE=false`). Introuvable, en échec ou illisible : aucun (saisie libre). `maintenant` : tests.
 */
export function modelesCopilotCli(maintenant: () => number = Date.now): (a: AppelModeles) => Promise<readonly string[]> {
	const lire = lectureEnCache<readonly string[]>({ gardeMs: 10 * 60_000, gardeEchecMs: 60_000, delaiMs: DELAI_MODELES_COPILOT_MS, repli: [], estEchec: (m) => m.length === 0, maintenant });
	return (a) => {
		const { commande } = a;
		if (commande === null) return Promise.resolve([]);
		const env = definies({ ...a.env, COPILOT_AUTO_UPDATE: 'false' });
		return lire(JSON.stringify([commande.commande, commande.avant]), () =>
			a.executer(commande.commande, [...commande.avant, 'help', 'config'], { env, delaiMs: DELAI_MODELES_COPILOT_MS }).then((r) => (r.code === 0 ? modelesDeLAide(r.sortie) : [])),
		);
	};
}
