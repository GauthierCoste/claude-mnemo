// Périmètre de la position d'une session et fiches « d'ailleurs » (spec contexte sobre § 7.1 et § 7.2).
// Pur : chemins relatifs à `_mnemo/`, en « / ».

import { dossiersAscendants, ficheDeDossier, positionDeFiche } from './chemin.ts';

export type FicheDuGraphe = { chemin: string; typeFiche: string; declareUnLieu: boolean }; // declareUnLieu : portée projet:/client: ou dossier_projet
/** Relations à verbe et liens `[[…]]` résolus ; jamais la parenté. */
export type Arete = { de: string; vers: string };

/** Types de fiche jamais proposés comme cartes. */
export const TYPES_NON_PROPOSABLES: ReadonlySet<string> = new Set(['source', 'dossier', 'consigne', 'profil', 'episode']);

/** Lieu déclaré le plus proche : la fiche elle-même si elle déclare, sinon la fiche de dossier déclarante la plus proche en remontant ; null : neutre. */
export function lieuDeclare(chemin: string, declarants: ReadonlySet<string>): string | null {
	if (declarants.has(chemin)) return chemin;
	const dossiers = dossiersAscendants(chemin);
	for (let i = dossiers.length - 1; i >= 0; i--) {
		const fiche = ficheDeDossier(dossiers[i]!);
		if (declarants.has(fiche)) return fiche;
	}
	return null;
}

export type Perimetre = { dans: Set<string>; ailleurs: Set<string> };

/** Fiches reliées à un saut d'une fiche de `depart`, dans un sens ou dans l'autre. */
export function voisinsDe(depart: ReadonlySet<string>, aretes: readonly Arete[]): Set<string> {
	const voisins = new Set<string>();
	for (const { de, vers } of aretes) {
		if (depart.has(de)) voisins.add(vers);
		if (depart.has(vers)) voisins.add(de);
	}
	return voisins;
}

/** position null (racine) : dans vide, ailleurs vide. */
export function perimetreDe(position: string | null, fiches: readonly FicheDuGraphe[], aretes: readonly Arete[]): Perimetre {
	const dans = new Set<string>();
	const ailleurs = new Set<string>();
	if (position === null) return { dans, ailleurs };

	// Seule une fiche de dossier (`d/d.md`) range des fiches sous son dossier.
	const dossier = positionDeFiche(position);
	const prefixe = dossier === position ? null : `${dossier}/`;
	const rangee = (chemin: string) => prefixe !== null && chemin.startsWith(prefixe);

	const declarants = new Set(fiches.filter((f) => f.declareUnLieu).map((f) => f.chemin));
	const ascendants = new Set(dossiersAscendants(position).map(ficheDeDossier));
	const unSaut = voisinsDe(new Set([position]), aretes);
	const deuxSauts = voisinsDe(unSaut, aretes);

	for (const { chemin } of fiches) {
		if (chemin === position || rangee(chemin)) continue;
		const lieu = lieuDeclare(chemin, declarants);
		// Une fiche reliée directement à la position est du périmètre (lien écrit exprès), comme son lieu.
		if (lieu !== null && lieu !== position && !ascendants.has(lieu) && !unSaut.has(lieu) && !unSaut.has(chemin)) ailleurs.add(chemin);
	}
	const existantes = new Set(fiches.map((f) => f.chemin));
	const candidates = [...existantes].filter(rangee).concat([...unSaut], [...deuxSauts]);
	for (const chemin of candidates) {
		if (chemin !== position && existantes.has(chemin) && !ailleurs.has(chemin)) dans.add(chemin);
	}
	return { dans, ailleurs };
}

/**
 * Fiches neutres : sans lieu déclaré (ni elles ni un dossier au-dessus d'elles), ni du périmètre (`dans`) ni d'ailleurs. Elles
 * conviennent à toute position ; à la racine (périmètre vide), ce sont les seules candidates (spec classement vivant § 3.3).
 */
export function neutres(fiches: readonly FicheDuGraphe[], perimetre: Perimetre, declarants: ReadonlySet<string>): Set<string> {
	const resultat = new Set<string>();
	for (const { chemin } of fiches) {
		if (!perimetre.dans.has(chemin) && !perimetre.ailleurs.has(chemin) && lieuDeclare(chemin, declarants) === null) resultat.add(chemin);
	}
	return resultat;
}

/** Fiches d'ailleurs rendues proposables parce que leur lieu est nommé : le lieu lui-même, les fiches rangées sous son dossier (sous-lieux compris) et celles dont il est le lieu déclaré. */
export function deverrouiller(lieuxNommes: readonly string[], fiches: readonly FicheDuGraphe[], declarants: ReadonlySet<string>): Set<string> {
	const lieux = new Set(lieuxNommes);
	const prefixes = lieuxNommes.map((l) => positionDeFiche(l)).filter((d, i) => d !== lieuxNommes[i]).map((d) => `${d}/`);
	const ouvertes = new Set(lieux);
	for (const { chemin } of fiches) {
		const lieu = lieuDeclare(chemin, declarants);
		if ((lieu !== null && lieux.has(lieu)) || prefixes.some((p) => chemin.startsWith(p))) ouvertes.add(chemin);
	}
	return ouvertes;
}
