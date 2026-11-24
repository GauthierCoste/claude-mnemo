import { normaliserCible } from '../../domaine/elements.ts';
import { analyserFiche, lireFiche } from '../../domaine/fiche.ts';
import { liensEcrits } from '../../domaine/liens-ecrits.ts';
import { aujourdhui, texteDeFiche } from '../commun.ts';
import { resolveurDeLiens } from '../liens.ts';
import type { FicheNommee } from '../liens.ts';
import type { Dependances } from '../ports.ts';

/**
 * Toutes les fiches de la mémoire, lues une fois avant un entretien, et la résolution de leurs liens comme le graphe la
 * fait (chemin, nom de fichier unique, titre, alias) : un lien écrit par le titre d'une fiche la désigne aussi.
 */
export type MemoireLue = {
	textes: ReadonlyMap<string, string>;
	/** Fiche désignée par la cible d'un lien telle qu'écrite (sans `#…` ni `|…`), ou null : absente, ambiguë, hors mémoire. */
	designee(cible: string): string | null;
	/** Fiches, autres que `chemin`, dont un lien (hors blocs de code) désigne `chemin`, dans l'ordre des chemins. */
	citeePar(chemin: string): string[];
};

export async function lireLaMemoire(dep: Dependances): Promise<MemoireLue> {
	const textes = new Map<string, string>();
	const nommees: FicheNommee[] = [];
	for (const chemin of await dep.coffre.toutesLesFiches()) {
		const texte = await dep.coffre.lire(chemin);
		if (texte === null) continue;
		textes.set(chemin, texte);
		const { fiche } = analyserFiche(chemin, texte);
		nommees.push({ chemin, titre: fiche.titre, alias: fiche.alias });
	}
	const resoudre = resolveurDeLiens(nommees);
	const designee = (cible: string): string | null => {
		const vers = normaliserCible(cible);
		return vers === null ? null : resoudre(vers);
	};
	return {
		textes,
		designee,
		citeePar: (chemin) =>
			[...textes]
				.filter(([autre, texte]) => autre !== chemin && liensEcrits(texte).some((l) => designee(l.cible) === chemin))
				.map(([autre]) => autre)
				.sort(),
	};
}

/**
 * Retire de la fiche `chemin`, dont des liens viennent d'être réécrits, les relations qui la désignent elle-même (une
 * relation vers la fiche supprimée ou absorbée, redirigée vers elle) et les doublons (même verbe vers la même fiche, la
 * première gardée : `lié à [[a]]` et `lié à [[b]]`, `a` redirigée vers `b`) ; texte inchangé si aucune, ou si la fiche est
 * illisible.
 */
export function relationsAssainies(dep: Dependances, memoire: MemoireLue, chemin: string, texte: string): string {
	let fiche;
	try {
		fiche = lireFiche(chemin, texte);
	} catch {
		return texte;
	}
	const vues = new Set<string>();
	const gardees = fiche.relations.filter((r) => {
		if (!('verbe' in r)) return true;
		const visee = memoire.designee(r.cible.split(/[#|]/u)[0]!);
		if (visee === chemin) return false;
		const cle = `${r.verbe}\u0000${visee ?? r.cible}`;
		if (vues.has(cle)) return false;
		vues.add(cle);
		return true;
	});
	if (gardees.length === fiche.relations.length) return texte;
	fiche.relations = gardees;
	fiche.updated = aujourdhui(dep);
	return texteDeFiche(dep, fiche);
}
