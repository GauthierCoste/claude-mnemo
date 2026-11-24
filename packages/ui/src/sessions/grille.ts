/**
 * Disposition de la grille des sessions, en calcul pur. Rien n'est reconstruit d'une
 * disposition à l'autre, seules les tailles changent (les transitions CSS animent `flex-grow` et `flex-basis`).
 */

export type EntreeGrille = {
	groupes: { cle: string; sessions: string[] }[];
	/** Session ouverte en grand ; null = la grille. */
	zoom: string | null;
	/** Lignes repliées par l'utilisateur. */
	replies: ReadonlySet<string>;
	/** Poids mémorisés (en pixels, au premier glissement d'un séparateur). */
	poidsLignes: Readonly<Record<string, number>>;
	poidsCellules: Readonly<Record<string, number>>;
};

export type Grille = {
	zoomee: boolean;
	lignes: { cle: string; mini: boolean; flexGrow: number }[];
	cellules: { id: string; rail: boolean; zoomee: boolean; flexGrow: number; flexBasis: string }[];
};

/** Largeur d'une cellule en rail (voisine de la cellule zoomée). */
export const LARGEUR_RAIL = '44px';
/** Minimums d'un glissement de séparateur : colonnes (cellules), lignes. */
export const MINIMUM_COLONNE = 170;
export const MINIMUM_LIGNE = 90;

/** Moyenne des poids mémorisés parmi `cles` ; null si aucun ne l'est. */
function moyenne(poids: Readonly<Record<string, number>>, cles: readonly string[]): number | null {
	const connus = cles.map((c) => poids[c]).filter((p): p is number => p !== undefined);
	return connus.length === 0 ? null : connus.reduce((t, p) => t + p, 0) / connus.length;
}

/**
 * Les poids mémorisés sont en pixels : une ligne ou une cellule sans poids (session lancée après un glissement, ligne
 * repliée pendant le glissement) prend la moyenne des poids mémorisés de ses voisines, sinon elle serait large d'un pixel.
 */
export function disposerGrille(e: EntreeGrille): Grille {
	const ligneZoomee = e.zoom === null ? null : (e.groupes.find((g) => g.sessions.includes(e.zoom!))?.cle ?? null);
	const zoom = ligneZoomee === null ? null : e.zoom;
	const moyenneLignes = moyenne(e.poidsLignes, e.groupes.map((g) => g.cle));
	const lignes = e.groupes.map((g) => {
		const mini = e.replies.has(g.cle) || (ligneZoomee !== null && ligneZoomee !== g.cle);
		const poids = e.poidsLignes[g.cle] ?? moyenneLignes ?? (g.sessions.length > 2 ? 1.5 : 1);
		return { cle: g.cle, mini, flexGrow: mini ? 0 : poids };
	});
	const cellules = e.groupes.flatMap((g) => {
		const moyenneGroupe = moyenne(e.poidsCellules, g.sessions);
		return g.sessions.map((id) => {
			const rail = ligneZoomee === g.cle && id !== zoom;
			const poids = e.poidsCellules[id] ?? moyenneGroupe ?? 1;
			return { id, rail, zoomee: id === zoom, flexGrow: rail ? 0 : poids, flexBasis: rail ? LARGEUR_RAIL : '0px' };
		});
	});
	return { zoomee: zoom !== null, lignes, cellules };
}

/** Nouvelles tailles de part et d'autre d'un séparateur déplacé de `deplacement` pixels ; chacune garde `minimum`. */
export function glisserSeparateur(tailleA: number, tailleB: number, deplacement: number, minimum: number): [number, number] {
	const total = tailleA + tailleB;
	if (total < 2 * minimum) return [tailleA, tailleB];
	const a = Math.max(minimum, Math.min(total - minimum, tailleA + deplacement));
	return [a, total - a];
}
