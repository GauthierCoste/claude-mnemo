/**
 * Résolution des liens `[[…]]` vers les fiches de la mémoire (graphe, vue d'une fiche, `voisins`, `servir`, `chercher`) :
 * par chemin, par nom de fichier s'il est unique, puis par titre ou alias s'il désigne une seule fiche (casse, accents et
 * espaces ignorés). Un lien qui remonte (`..`), absolu, ou qui passe par un segment caché ne mène jamais à une fiche.
 */
import { plier } from '@mnemo/commun';
import { nomDeLaFiche } from '../domaine/chemin.ts';
import type { Lien } from '../domaine/elements.ts';
import type { Dependances } from './ports.ts';

export type FicheNommee = { chemin: string; titre: string; alias: string[] };

/** Forme d'un titre ou d'un alias pour la résolution des liens : sans casse, sans accents, espaces réduits. */
export const normaliserTitre = (texte: string): string =>
	plier(texte).replace(/\s+/gu, ' ').trim();

/** Vrai si la cible écrite reste dans la mémoire : relative, sans `.`, `..`, segment vide ou caché, sans `\` ni lecteur. */
export function cibleSure(ecrit: string): boolean {
	if (ecrit === '' || ecrit.includes('\\') || ecrit.startsWith('/') || /^[a-z]:/iu.test(ecrit)) return false;
	return ecrit.split('/').every((s) => s !== '' && !s.startsWith('.'));
}

/** Ajoute `chemin` sous `cle` ; une clé partagée par plusieurs fiches devient ambiguë (null). */
function noter(table: Map<string, string | null>, cle: string, chemin: string): void {
	if (cle === '') return;
	const deja = table.get(cle);
	if (deja === undefined) table.set(cle, chemin);
	else if (deja !== chemin) table.set(cle, null);
}

/**
 * Résolveur pour ces fiches : prend la cible telle que l'index la garde (chemin écrit, `.md` ajouté) et rend le chemin de
 * la fiche visée, ou null.
 */
export function resolveurDeLiens(fiches: readonly FicheNommee[]): (vers: string) => string | null {
	const chemins = new Set(fiches.map((f) => f.chemin));
	const parNom = new Map<string, string | null>();
	const parTitre = new Map<string, string | null>();
	for (const f of fiches) {
		noter(parNom, nomDeLaFiche(f.chemin), f.chemin);
		noter(parTitre, normaliserTitre(f.titre), f.chemin);
		for (const a of f.alias) noter(parTitre, normaliserTitre(a), f.chemin);
	}
	return (vers) => {
		if (!cibleSure(vers)) return null;
		if (chemins.has(vers)) return vers;
		const nom = vers.replace(/\.md$/u, '');
		if (!nom.includes('/')) {
			const parLeNom = parNom.get(nom);
			if (parLeNom) return parLeNom;
		}
		return parTitre.get(normaliserTitre(nom)) ?? null;
	};
}

/** Liens de la mémoire d'après l'index (à synchroniser avant), résolus par `resolveurDeLiens`, titres lus une fois. */
export type LiensResolus = {
	/** Titre et alias de chaque fiche indexée (ceux qui servent à résoudre). */
	titres: readonly FicheNommee[];
	resoudre(vers: string): string | null;
	/** Liens sortants de la fiche ; `cible` : la fiche visée, null si aucune (absente, ambiguë, hors mémoire). */
	sortants(chemin: string): Promise<(Lien & { cible: string | null })[]>;
	/** Liens des autres fiches qui se résolvent vers celle-ci, dans l'ordre de l'index. */
	entrants(chemin: string): Promise<Lien[]>;
};

export async function liensDeLaMemoire(dep: Dependances): Promise<LiensResolus> {
	const titres = await dep.index.titres();
	const resoudre = resolveurDeLiens(titres);
	let parCible: Map<string, Lien[]> | null = null;
	return {
		titres,
		resoudre,
		async sortants(chemin) {
			return (await dep.index.liens(chemin)).sortants.map((l) => ({ ...l, cible: resoudre(l.vers) }));
		},
		async entrants(chemin) {
			if (parCible === null) {
				parCible = new Map();
				for (const lien of await dep.index.tousLesLiens()) {
					const cible = resoudre(lien.vers);
					if (cible !== null && cible !== lien.de) parCible.set(cible, [...(parCible.get(cible) ?? []), lien]);
				}
			}
			return parCible.get(chemin) ?? [];
		},
	};
}
