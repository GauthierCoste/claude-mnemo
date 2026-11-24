import { JETONS_BRANCHES } from './couleurs.ts';

/** Branche de premier niveau d'une fiche : son premier dossier, '' pour une fiche de la racine. */
export function brancheDePremierNiveau(chemin: string): string {
	const morceaux = chemin.split('/');
	return morceaux.length > 1 ? morceaux[0]! : '';
}

/** Rang de chaque branche de premier niveau ('' = racine), dans l'ordre alphabétique : la couleur d'une fiche dans toutes les vues. */
export function rangsDesBranches(branches: Iterable<string>): Map<string, number> {
	return new Map([...new Set(branches)].sort((a, b) => a.localeCompare(b)).map((b, rang) => [b, rang]));
}

/** Rangs des branches des fiches `chemins` (`rangsDesBranches` de leur branche de premier niveau). */
export function rangsDesFiches(chemins: readonly string[]): Map<string, number> {
	return rangsDesBranches(chemins.map(brancheDePremierNiveau));
}

/** Couleur du point d'une fiche : le jeton `--branche-n` de sa branche ; `--dim` si la branche est inconnue. */
export function couleurDeBranche(rangs: ReadonlyMap<string, number>, chemin: string): string {
	const rang = rangs.get(brancheDePremierNiveau(chemin));
	return rang === undefined ? 'var(--dim)' : `var(${JETONS_BRANCHES[rang % JETONS_BRANCHES.length]!})`;
}
