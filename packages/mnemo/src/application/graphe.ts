/**
 * Données du graphe et de l'arbre de la mémoire (interface, jalon 7), tirées de l'index seul : aucun fichier relu. Forme
 * d'entrée de `preparerGraphe` de l'interface (Mnemo n'a pas de notions).
 */
import { ficheDeDossier } from '../domaine/chemin.ts';
import { estTypeDeLieu } from '../domaine/elements.ts';
import { resolveurDeLiens } from './liens.ts';
import type { Dependances } from './ports.ts';
import { DOSSIER_MEMOIRE } from '../domaine/dossier-memoire.ts';

/** Mêmes formes que `FicheGraphe`, `LienGraphe` et `DonneesGraphe` du contrat (l'application ne l'importe pas). */
export type FicheGraphe = {
	chemin: string;
	titre: string;
	type: string;
	alias: string[];
	etats: 'a_confirmer'[];
	faitsActifs: number;
	categories: Record<string, number>;
	/** Dates (AAAA-MM-JJ) des faits actifs : l'index garde la date d'apprentissage, pas le début de validité. */
	dates: string[];
	branche: string;
	parent: string | null;
};
export type LienGraphe = { source: string; cible: string | null; cibleEcrite: string; relation: string | null };
export type DonneesGraphe = {
	coffre: string;
	fiches: FicheGraphe[];
	liens: LienGraphe[];
	notions: [];
	sens: { disponible: boolean; etat: string };
	modifieeMs: number;
};

/** Statuts d'un fait qui ne compte plus. */
const INACTIFS = new Set(['invalide', 'ancienne_version']);

/** Dossier d'une fiche ('' = racine). */
const brancheDe = (chemin: string) => chemin.slice(0, Math.max(0, chemin.lastIndexOf('/')));

/**
 * Fiche de lieu de la branche de `chemin` (`<d>/<nom de d>.md` d'un type de lieu, `estTypeDeLieu`), sinon celle du
 * premier dossier au-dessus qui en a une ; jamais la fiche elle-même.
 */
export function parentDe(chemin: string, estUnLieu: (c: string) => boolean): string | null {
	let dossier = brancheDe(chemin);
	while (dossier !== '') {
		const fiche = ficheDeDossier(dossier);
		if (fiche !== chemin && estUnLieu(fiche)) return fiche;
		dossier = brancheDe(dossier);
	}
	return null;
}

export async function donneesGraphe(dep: Dependances): Promise<DonneesGraphe> {
	const [titres, elements, liens, journal] = await Promise.all([
		dep.index.titres(),
		dep.index.elements({ genres: ['fiche', 'fait', 'consigne'] }),
		dep.index.tousLesLiens(),
		dep.historique.journal('1970-01-01', 1),
	]);

	const fiches = new Map<string, FicheGraphe>();
	for (const t of titres) {
		fiches.set(t.chemin, { chemin: t.chemin, titre: t.titre, type: 'sujet', alias: t.alias, etats: [], faitsActifs: 0, categories: {}, dates: [], branche: brancheDe(t.chemin), parent: null });
	}
	for (const e of elements) {
		const f = fiches.get(e.chemin);
		if (f === undefined) continue;
		if (e.genre !== 'fait') {
			f.type = e.typeFiche;
			continue;
		}
		if (INACTIFS.has(e.statut)) continue;
		f.faitsActifs++;
		if (e.statut === 'a_confirmer' && f.etats.length === 0) f.etats.push('a_confirmer');
		if (e.categorie !== null) f.categories[e.categorie] = (f.categories[e.categorie] ?? 0) + 1;
		if (e.date !== null) f.dates.push(e.date);
	}
	const estUnLieu = (c: string): boolean => {
		const f = fiches.get(c);
		return f !== undefined && estTypeDeLieu(f.type);
	};
	for (const f of fiches.values()) f.parent = parentDe(f.chemin, estUnLieu);

	const resoudre = resolveurDeLiens(titres);
	const liensGraphe: LienGraphe[] = liens.map((l) => ({ source: l.de, cible: resoudre(l.vers), cibleEcrite: l.vers.replace(/\.md$/u, ''), relation: l.verbe }));

	const modele = dep.sens.modele();
	return {
		coffre: DOSSIER_MEMOIRE,
		fiches: [...fiches.values()],
		liens: liensGraphe,
		notions: [],
		sens: { disponible: modele !== null, etat: modele !== null ? 'prêt' : 'absent' },
		modifieeMs: journal[0]?.dateMs ?? 0,
	};
}
