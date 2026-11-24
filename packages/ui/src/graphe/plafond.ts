/**
 * Grande mémoire : au-delà de `PLAFOND_FICHES`, le graphe montre une branche à la fois ; au-delà de `SEUIL_PIXELS_UN`
 * nœuds visibles, la scène se dessine à l'échelle de pixels 1.
 */

export const PLAFOND_FICHES = 2500;
export const SEUIL_PIXELS_UN = 1500;

const profondeur = (branche: string) => branche.split('/').length;

/** La plus grosse branche (première en cas d'égalité), ou null. */
function plusGrosse(branches: [string, number][]): string | null {
	let meilleure: [string, number] | null = null;
	for (const entree of branches) if (!meilleure || entree[1] > meilleure[1]) meilleure = entree;
	return meilleure?.[0] ?? null;
}

/**
 * Branche ouverte au départ : '' (toute la mémoire) si `total` tient sous le plafond ; sinon, niveau après niveau en
 * partant du premier, la plus grosse branche qui y tient ; si aucune n'y tient, la plus grosse des branches sans
 * sous-branche (`depasseLePlafond` le dit, pour l'avis).
 */
export function brancheDeDepart(branches: [string, number][], total: number): string {
	if (total <= PLAFOND_FICHES) return '';
	const plusProfonde = Math.max(0, ...branches.map(([b]) => profondeur(b)));
	for (let niveau = 1; niveau <= plusProfonde; niveau++) {
		const tient = plusGrosse(branches.filter(([b, n]) => profondeur(b) === niveau && n <= PLAFOND_FICHES));
		if (tient !== null) return tient;
	}
	const feuilles = branches.filter(([b]) => !branches.some(([autre]) => autre.startsWith(`${b}/`)));
	return plusGrosse(feuilles) ?? '';
}

/** `branche` compte plus de fiches que le plafond (grande mémoire sans branche assez petite). */
export function depasseLePlafond(branches: [string, number][], branche: string): boolean {
	return (new Map(branches).get(branche) ?? 0) > PLAFOND_FICHES;
}

/**
 * Branche à ouvrir pour montrer une fiche rangée dans `branche` : la plus large de ses branches parentes qui tient sous
 * le plafond (à défaut, la sienne). Une fiche à la racine du coffre n'en a pas : la branche `actuelle` reste, « Tout le
 * coffre » n'étant jamais ouvert en grande mémoire.
 */
export function brancheContenant(branches: [string, number][], branche: string, actuelle: string): string {
	if (branche === '') return actuelle;
	const nombres = new Map(branches);
	const noms = branche.split('/');
	for (let n = 1; n <= noms.length; n++) {
		const parente = noms.slice(0, n).join('/');
		if ((nombres.get(parente) ?? 0) <= PLAFOND_FICHES) return parente;
	}
	return branche;
}
