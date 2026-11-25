import type { MoteurDuPoste } from '../../../application/ports.ts';
import { environnementPermisCodex } from '../../../application/moteurs/codex/session.ts';
import { versionParCommande } from '../version-par-commande.ts';

export { DELAI_VERSION_MS } from '../version-par-commande.ts';

/** Version de Codex lue par `codex --version` (`versionParCommande`), sans les variables interdites à Codex. */
export const versionCodex = (maintenant: () => number = Date.now): NonNullable<MoteurDuPoste['version']> => versionParCommande(environnementPermisCodex, maintenant);
