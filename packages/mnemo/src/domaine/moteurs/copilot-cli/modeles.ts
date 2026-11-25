import { estModele } from '@mnemo/commun';

/**
 * Modèles de GitHub Copilot CLI lus dans `copilot help config` (1.0.116, sans réseau : la liste du réglage `model`, une ligne
 * `- "<modèle>"` chacun, sous la ligne `` `model`: ``), dans leur ordre, sans doublon ni nom refusé par `estModele`. Aucune
 * liste lisible : aucun (le modèle par défaut de Copilot, saisie libre).
 */
export function modelesDeLAide(sortie: string): string[] {
	const lignes = sortie.split(/\r?\n/u);
	const debut = lignes.findIndex((l) => /^\s*`model`:/u.test(l));
	if (debut === -1) return [];
	const modeles: string[] = [];
	for (const ligne of lignes.slice(debut + 1)) {
		const nom = /^\s*-\s+"([^"]*)"\s*$/u.exec(ligne)?.[1];
		if (nom === undefined) break;
		if (nom !== '' && estModele(nom) && !modeles.includes(nom)) modeles.push(nom);
	}
	return modeles;
}
