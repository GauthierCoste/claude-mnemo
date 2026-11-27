/**
 * Arbre des fiches de Mémoire › Fichiers : lignes à afficher, dossiers repliés et filtre
 * appliqués. Dans chaque dossier : sa fiche `dossier` (même nom que lui) en tête, puis ses sous-dossiers, puis ses autres
 * fiches, par ordre alphabétique ; les fiches de la racine viennent après les dossiers.
 */
import type { FicheGraphe } from '@mnemo/contrat';
import { plier } from '@mnemo/commun';

export type NoeudArbre =
	/** `nombre` : fiches retenues du dossier, sous-dossiers compris (ce qu'il cache, replié). */
	| { genre: 'dossier'; cle: string; nom: string; profondeur: number; replie: boolean; nombre: number }
	/** `branche` : dossier de premier niveau de la fiche ('' = racine), qui donne sa couleur. */
	| { genre: 'fiche'; chemin: string; titre: string; profondeur: number; branche: string };

const comparer = (a: string, b: string) => a.localeCompare(b, 'fr');

type Dossier = { nom: string; cle: string; dossiers: Map<string, Dossier>; fiches: FicheGraphe[] };

const dossierDe = (fiche: FicheGraphe) => fiche.chemin.split('/').slice(0, -1);

/** Clés des dossiers qui contiennent la fiche `chemin`, du premier niveau au plus profond (« projets », « projets/erp »…). */
export function dossiersDe(chemin: string): string[] {
	const morceaux = chemin.split('/').slice(0, -1);
	return morceaux.map((_, i) => morceaux.slice(0, i + 1).join('/'));
}
const nomDeFichier = (fiche: FicheGraphe) => (fiche.chemin.split('/').pop() ?? '').replace(/\.md$/, '');

export function lignesArbre(fiches: FicheGraphe[], filtre: string, replies: ReadonlySet<string>): NoeudArbre[] {
	const q = plier(filtre.trim());
	const retenues = q ? fiches.filter((f) => plier(f.titre).includes(q) || f.alias.some((a) => plier(a).includes(q))) : fiches;

	const racine: Dossier = { nom: '', cle: '', dossiers: new Map(), fiches: [] };
	for (const fiche of retenues) {
		let courant = racine;
		for (const nom of dossierDe(fiche)) {
			let suivant = courant.dossiers.get(nom);
			if (!suivant) {
				suivant = { nom, cle: courant.cle ? `${courant.cle}/${nom}` : nom, dossiers: new Map(), fiches: [] };
				courant.dossiers.set(nom, suivant);
			}
			courant = suivant;
		}
		courant.fiches.push(fiche);
	}

	const lignes: NoeudArbre[] = [];
	const fiche = (f: FicheGraphe, profondeur: number) =>
		lignes.push({ genre: 'fiche', chemin: f.chemin, titre: f.titre, profondeur, branche: dossierDe(f)[0] ?? '' });
	const compter = (d: Dossier): number => d.fiches.length + [...d.dossiers.values()].reduce((n, x) => n + compter(x), 0);
	const parcourir = (d: Dossier, profondeur: number) => {
		const enTete = d.fiches.filter((f) => d.nom !== '' && nomDeFichier(f) === d.nom);
		for (const f of enTete) fiche(f, profondeur);
		for (const sous of [...d.dossiers.values()].sort((a, b) => comparer(a.nom, b.nom))) {
			const replie = replies.has(sous.cle);
			lignes.push({ genre: 'dossier', cle: sous.cle, nom: sous.nom, profondeur, replie, nombre: compter(sous) });
			if (!replie) parcourir(sous, profondeur + 1);
		}
		for (const f of d.fiches.filter((x) => !enTete.includes(x)).sort((a, b) => comparer(a.titre, b.titre))) fiche(f, profondeur);
	};
	parcourir(racine, 0);
	return lignes;
}
