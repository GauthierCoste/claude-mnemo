import { estModele } from '@mnemo/commun';
import { elementsDuTableau, entreesToml } from '../toml-lecture.ts';

/** Modèles intégrés à Mistral Vibe 3.1.5 (alias de `--model`), hors modèles de la voix. */
export const MODELES_INTEGRES_MISTRAL_VIBE: readonly string[] = ['mistral-large-4-0', 'mistral-medium-3.5'];

/**
 * Modèles proposés pour `--model` : les alias des `[[models]]` de `config.toml` de l'utilisateur (`texte`, null : absent),
 * puis les modèles intégrés ; sans doublon ni alias refusé par `estModele`. `config.toml` illisible : les intégrés seulement.
 */
export function modelesDeConfig(texte: string | null): string[] {
	const entrees = texte === null ? null : entreesToml(texte);
	const configures = entrees === null ? [] : (elementsDuTableau(entrees, 'models')?.elements ?? []).map((e) => e.valeurs['alias']);
	const modeles: string[] = [];
	for (const alias of [...configures, ...MODELES_INTEGRES_MISTRAL_VIBE]) if (typeof alias === 'string' && estModele(alias) && alias !== '' && !modeles.includes(alias)) modeles.push(alias);
	return modeles;
}
