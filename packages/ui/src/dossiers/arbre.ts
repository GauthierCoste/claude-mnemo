/** Arbre des dossiers de la racine : chaque niveau se charge à part (`dossiers?chemin=`). */
import type { DossierVue, NiveauDossiersVue } from '@mnemo/contrat';

/** Un niveau chargé : un dossier et ses sous-dossiers, ou le motif de son échec. */
export type Niveau = NiveauDossiersVue | { erreur: string };

/** Gestes de l'utilisateur : dossiers dépliés ou repliés à la main (un repli l'emporte sur un dépliage automatique). */
export type Pliage = { deplies: ReadonlySet<string>; replies: ReadonlySet<string> };
export const PLIAGE_INITIAL: Pliage = { deplies: new Set(), replies: new Set() };

/** Niveaux affichés dépliés à l'ouverture : la racine et chacun de ses dossiers. */
export const NIVEAUX_AU_DEPART = 2;

export type LigneArbre = {
	chemin: string;
	nom: string;
	/** 0 : la racine. */
	profondeur: number;
	/** null tant que la description du dossier n'est pas chargée (la racine, avant son niveau). */
	dossier: DossierVue | null;
	/** null : sans sous-dossier (niveau chargé vide, dossier illisible) ; sinon vrai s'il est déplié. */
	deplie: boolean | null;
	/** Motif de l'échec du chargement de son niveau. */
	erreurNiveau: string | null;
};

/** Chaque dossier qui contient un des `chemins`, la racine comprise : ils se déplient d'eux-mêmes. */
function ascendants(chemins: readonly string[]): Set<string> {
	const resultat = new Set(['']);
	for (const chemin of chemins) {
		const segments = chemin.split('/');
		for (let i = 1; i < segments.length; i++) resultat.add(segments.slice(0, i).join('/'));
	}
	return resultat;
}

/**
 * Lignes affichées, dans l'ordre de l'arbre, et niveaux visibles (chaque dossier lisible déplié, même vide) : un niveau qui le devient
 * est relu. Se déplient d'eux-mêmes les `NIVEAUX_AU_DEPART` premiers niveaux et le chemin de chacun des `ouverts`.
 */
export function lignesArbre(o: { niveaux: ReadonlyMap<string, Niveau>; nomRacine: string; pliage: Pliage; ouverts: readonly string[] }): { lignes: LigneArbre[]; niveauxVisibles: string[] } {
	const automatiques = ascendants(o.ouverts);
	const lignes: LigneArbre[] = [];
	const niveauxVisibles: string[] = [];
	const visiter = (chemin: string, nom: string, profondeur: number, dossier: DossierVue | null): void => {
		const niveau = o.niveaux.get(chemin);
		const lisible = dossier === null || dossier.erreur === null;
		const demande = !o.pliage.replies.has(chemin) && (o.pliage.deplies.has(chemin) || automatiques.has(chemin) || profondeur < NIVEAUX_AU_DEPART);
		const enfants = niveau !== undefined && 'sousDossiers' in niveau ? niveau.sousDossiers : null;
		const deplie = !lisible || (enfants !== null && enfants.length === 0) ? null : demande;
		if (lisible && demande) niveauxVisibles.push(chemin);
		const decrit = niveau !== undefined && 'dossier' in niveau ? niveau.dossier : dossier;
		lignes.push({ chemin, nom, profondeur, dossier: decrit, deplie, erreurNiveau: niveau !== undefined && 'erreur' in niveau ? niveau.erreur : null });
		if (deplie === true && enfants !== null) for (const d of enfants) visiter(d.chemin, d.nom, profondeur + 1, d);
	};
	visiter('', o.nomRacine, 0, null);
	return { lignes, niveauxVisibles };
}

/** Le pliage après un clic sur le chevron de `chemin` (`deplie` : son état affiché avant le clic). */
export function basculer(pliage: Pliage, chemin: string, deplie: boolean): Pliage {
	const deplies = new Set(pliage.deplies);
	const replies = new Set(pliage.replies);
	if (deplie) {
		deplies.delete(chemin);
		replies.add(chemin);
	} else {
		replies.delete(chemin);
		deplies.add(chemin);
	}
	return { deplies, replies };
}

/** « Tout replier » : chaque dossier dont le niveau est chargé, sauf la racine. */
export function toutReplier(niveaux: ReadonlyMap<string, Niveau>): Pliage {
	return { deplies: new Set(), replies: new Set([...niveaux.keys()].filter((c) => c !== '')) };
}

/** « Tout déplier » : chaque dossier dont le niveau est chargé (rien n'est demandé au-delà). */
export function toutDeplier(niveaux: ReadonlyMap<string, Niveau>): Pliage {
	return { deplies: new Set(niveaux.keys()), replies: new Set() };
}
