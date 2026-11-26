/**
 * Environnement des commandes de `mnemo` lancées par l'app (le service, `mnemo declarer`, `mnemo commande`) : celui de l'app
 * et un `PATH` où trouver `git` et `claude`. Sous macOS, celui de la configuration (le `PATH` du terminal, lu par
 * l'assistant ou « Reprendre le PATH du terminal » : l'app ouverte depuis le Finder n'a que le `PATH` minimal). Sous
 * Windows, l'app reçoit déjà le `Path` complet du compte : c'est celui du processus, à jour à chaque lancement de l'app
 * (un outil installé depuis l'assistant est trouvé), qui sert ; celui de la configuration, figé à l'assistant, n'est qu'un
 * repli s'il manque.
 */
import { avecVariable, variable } from '@mnemo/commun';

export function environnementAvecPath(base: NodeJS.ProcessEnv, pathConfiguration: string, plateforme: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
	if (plateforme === 'win32') {
		const vivant = variable(base, 'PATH', plateforme);
		if (vivant !== undefined && vivant !== '') return { ...base };
	}
	return avecVariable(base, 'PATH', pathConfiguration, plateforme);
}
