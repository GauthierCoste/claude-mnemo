import { memeEnonce } from './fait.ts';
import type { Fait } from './fait.ts';
import type { Regles, TypeSource } from './regles.ts';

export type Candidat = { fait: Fait; typeSource: TypeSource; remplaceExplicitement: boolean; date: string };
export type Existant = { fait: Fait; typeSource: TypeSource; date: string };
export type Decision = 'doublon' | 'ajouter' | 'remplacer' | 'contradiction';

/**
 * Décide du sort d'un fait candidat face au seul fait existant qui le concerne (même énoncé, ou celui que `remplace` désigne).
 * Les dates sont des chaînes AAAA-MM-JJ, comparées telles quelles.
 */
export function arbitrer(regles: Regles, candidat: Candidat, existant?: Existant): Decision {
	if (existant === undefined) return 'ajouter';
	if (memeEnonce(candidat.fait, existant.fait)) return 'doublon';
	const fiabiliteCandidat = regles.fiabilites[candidat.typeSource];
	const fiabiliteExistant = regles.fiabilites[existant.typeSource];
	// Un remplacement explicite par une source moins fiable ne barre rien seul : l'humain tranche (contradiction à confirmer).
	if (candidat.remplaceExplicitement) return fiabiliteCandidat < fiabiliteExistant ? 'contradiction' : 'remplacer';
	if (fiabiliteCandidat > fiabiliteExistant) return 'remplacer';
	const plusRecent = candidat.date >= existant.date;
	if (fiabiliteCandidat === fiabiliteExistant) return plusRecent ? 'remplacer' : 'doublon';
	// Moins fiable : plus récent, il contredit ; plus ancien, il n'apporte rien à écrire (choix de Claude).
	return candidat.date > existant.date ? 'contradiction' : 'doublon';
}

/** Vrai si l'écriture doit attendre la confirmation de l'humain. */
export function doitEtreConfirme(regles: Regles, candidat: Candidat, decision: Decision): boolean {
	if (decision === 'contradiction') return true;
	if (candidat.fait.nature === 'infere') return true;
	const categorie = candidat.fait.categorie;
	return categorie !== undefined && regles.categoriesAEnjeu.includes(categorie);
}
