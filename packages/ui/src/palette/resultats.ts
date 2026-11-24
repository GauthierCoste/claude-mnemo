/**
 * Résultats de la palette (⌘K) : un seul classement, celui du moteur de recherche du service (mots, sens, graphe,
 * reranker), les éléments d'une même fiche regroupés sous elle, au rang du premier. En tête, les sessions dont l'objectif
 * ou le dossier correspond nettement, les vivantes puis les terminées (sans texte : les vivantes seules) ; les fiches dont le titre correspond ne sont qu'un affichage
 * provisoire, le temps que le moteur réponde. Filtres : Tout, Sessions, Fiches, Documents (appliqués par le service), et
 * « Ce projet » (sans objet avec Documents).
 */
import type { FicheGraphe, FicheVue, ProjetVue, SessionVue, TrouveRechercheVue } from '@mnemo/contrat';
import { plier } from '@mnemo/commun';

export const SESSIONS_MAX = 8;
export const PROVISOIRES_MAX = 8;
export const TROUVES_MAX = 12;

export type Filtre = 'tout' | 'sessions' | 'fiches' | 'documents';
export const FILTRES: readonly { valeur: Filtre; libelle: string }[] = [
	{ valeur: 'tout', libelle: 'Tout' },
	{ valeur: 'sessions', libelle: 'Sessions' },
	{ valeur: 'fiches', libelle: 'Fiches' },
	{ valeur: 'documents', libelle: 'Documents' },
];

/** Projet au premier plan (« Ce projet ») : le dossier d'épisodes des sessions, et la position de la mémoire. */
export type Projet = ProjetVue;

export type Resultat =
	| { cle: string; genre: 'session'; session: SessionVue }
	| { cle: string; genre: 'provisoire'; fiche: FicheGraphe }
	/** `trouve` : la fiche si le moteur l'a rendue, sinon le premier élément ; `rattaches` : les autres de la même fiche. */
	| { cle: string; genre: 'trouve'; trouve: TrouveRechercheVue; rattaches: TrouveRechercheVue[] };

/** Mots d'une requête, pliés, sans ponctuation. */
export function motsDe(q: string): string[] {
	return plier(q)
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);
}

/**
 * Vrai si chaque mot de la requête est, dans l'un des textes, un mot entier ou le début d'un mot (3 lettres au moins) :
 * « stocks » et « sto » trouvent « module stocks », pas « st » ni « ock ».
 */
export function correspondNettement(mots: readonly string[], textes: readonly (string | null | undefined)[]): boolean {
	if (mots.length === 0) return false;
	const tokens = textes.flatMap((t) => (t ? motsDe(t) : []));
	return mots.every((m) => tokens.some((t) => t === m || (m.length >= 3 && t.startsWith(m))));
}

/** Vrai si chaque mot figure dans l'un des textes (sous-chaîne) : l'affichage provisoire des fiches par leur titre. */
function contient(mots: readonly string[], textes: readonly string[]): boolean {
	const plies = textes.map(plier);
	return mots.every((m) => plies.some((t) => t.includes(m)));
}

/** Un document : une fiche `source`, où qu'elle soit rangée. */
export function estDocument(typeFiche: string): boolean {
	return typeFiche === 'source';
}

/** Une fiche du projet : sa position elle-même (une fiche simple porte le projet), ou ce qui est rangé dessous. */
const dansProjet = (chemin: string, projet: Projet | null) => projet === null || chemin === projet.position || chemin.startsWith(`${projet.position}/`);

/** Clé d'un résultat : celle de sa fiche, provisoire ou trouvée (la sélection la suit). */
export const cleFiche = (chemin: string): string => `f:${chemin}`;

export type EntreePalette = {
	q: string;
	sessions: readonly SessionVue[];
	fiches: readonly FicheGraphe[];
	/** Réponse du moteur (ordre gardé) ; null tant qu'il n'a pas répondu à ce texte. */
	moteur: readonly TrouveRechercheVue[] | null;
	filtre: Filtre;
	/** « Ce projet » coché (et utilisable) : sessions du projet, fiches sous sa position. */
	projet: Projet | null;
	/** « Tout voir » demandé : aucune borne (`SESSIONS_MAX`, `PROVISOIRES_MAX`, `TROUVES_MAX`). */
	tout: boolean;
};

/** Les résultats affichés, et `enPlus` : ceux que les bornes de la palette cachent. */
export type ResultatsPalette = { resultats: Resultat[]; enPlus: number };

/** « Ce projet » est sans objet avec le filtre Documents. */
export const projetUtilisable = (filtre: Filtre): boolean => filtre !== 'documents';

export function resultatsPalette(e: EntreePalette): ResultatsPalette {
	const mots = motsDe(e.q);
	const sortie: Resultat[] = [];
	let enPlus = 0;
	/** Les `max` premiers (tous avec `tout`) ; le reste est compté dans `enPlus`. */
	const borner = <T>(liste: readonly T[], max: number): readonly T[] => {
		if (e.tout || liste.length <= max) return liste;
		enPlus += liste.length - max;
		return liste.slice(0, max);
	};
	if (e.filtre === 'tout' || e.filtre === 'sessions') {
		const duProjet = e.sessions.filter((x) => e.projet === null || x.projet === e.projet.projet);
		const vivantes = duProjet.filter((x) => x.etat !== 'terminee');
		const terminees = duProjet.filter((x) => x.etat === 'terminee');
		const retenues = mots.length ? [...vivantes, ...terminees].filter((x) => correspondNettement(mots, [x.objectif, x.dossier])) : vivantes;
		for (const x of borner(retenues, SESSIONS_MAX)) sortie.push({ cle: `s:${x.id}`, genre: 'session', session: x });
	}
	if (e.filtre === 'sessions' || mots.length === 0) return { resultats: sortie, enPlus };
	const garder = (chemin: string, typeFiche: string) =>
		dansProjet(chemin, e.projet) && (e.filtre === 'tout' || (e.filtre === 'documents') === estDocument(typeFiche));
	if (e.moteur === null) {
		const provisoires = borner(e.fiches.filter((f) => garder(f.chemin, f.type) && contient(mots, [f.titre, ...f.alias])), PROVISOIRES_MAX);
		for (const f of provisoires) sortie.push({ cle: cleFiche(f.chemin), genre: 'provisoire', fiche: f });
		return { resultats: sortie, enPlus };
	}
	// le moteur a déjà appliqué filtre et projet : son ordre est gardé, les éléments d'une fiche regroupés sous elle
	const groupes = new Map<string, { premier: TrouveRechercheVue; elements: TrouveRechercheVue[] }>();
	for (const t of e.moteur) {
		const g = groupes.get(t.chemin);
		if (g) {
			if (!g.elements.some((x) => x.id === t.id)) g.elements.push(t);
		} else groupes.set(t.chemin, { premier: t, elements: [t] });
	}
	for (const [chemin, g] of borner([...groupes], TROUVES_MAX)) {
		const tete = g.elements.find((x) => x.genre === 'fiche') ?? g.premier;
		sortie.push({ cle: cleFiche(chemin), genre: 'trouve', trouve: tete, rattaches: g.elements.filter((x) => x !== tete) });
	}
	return { resultats: sortie, enPlus };
}

/** Ce que le moteur reçoit : le dossier du projet coché, le genre du filtre. */
export function demandeAuMoteur(filtre: Filtre, projet: Projet | null): { dossier: string | null; genre: 'fiche' | 'document' | null } {
	return { dossier: projet?.position ?? null, genre: filtre === 'fiches' ? 'fiche' : filtre === 'documents' ? 'document' : null };
}

/** Projet d'une fiche ouverte dans Mémoire : celui que le service rend avec la fiche (`FicheVue.projet`), null hors d'un projet. */
export function projetDeFiche(fiche: Pick<FicheVue, 'projet'> | undefined): Projet | null {
	return fiche?.projet ?? null;
}
