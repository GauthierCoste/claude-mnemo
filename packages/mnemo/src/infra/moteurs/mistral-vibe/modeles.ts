import type { AppelModeles } from '../../../application/ports.ts';
import { modelesDeConfig } from '../../../domaine/moteurs/mistral-vibe/modeles.ts';
import { texteOuAbsent } from '../../fichier-de-configuration.ts';
import { cheminConfigVibe } from './dossier-vibe.ts';

/**
 * Modèles de Mistral Vibe (aucune commande ne les liste) : les alias des `[[models]]` de `config.toml`, puis les modèles
 * intégrés à Vibe ; lus à chaque appel (un fichier local). Vibe introuvable : aucun.
 */
export async function modelesMistralVibe(a: AppelModeles): Promise<readonly string[]> {
	if (a.commande === null) return [];
	return modelesDeConfig(await texteOuAbsent(cheminConfigVibe(a.env)).catch(() => null));
}
