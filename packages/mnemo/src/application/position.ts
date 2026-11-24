import type { Dependances } from './ports.ts';
import { SANS_EXTRACTION, synchroniser } from './synchroniser.ts';
import { cheminValide, cleDeCasse, positionDeFiche } from '../domaine/chemin.ts';
import { estTypeDeLieu } from '../domaine/elements.ts';

/** Où l'on se trouve dans la mémoire : un chemin relatif à la racine Mnemo (« » = racine). */
export type Position = { chemin: string };

/** Chemin de position utilisable : `cheminValide`, ni absolu ni « .. » ; « » (la racine) est accepté ; sinon null. */
export function positionValide(chemin: string): string | null {
	return chemin === '' ? '' : cheminValide(chemin);
}

/** « a\b/ » → « a/b » ; null si le résultat n'est pas un chemin valide (la racine « » reste valide). */
function normaliser(relatif: string): string | null {
	const net = relatif.replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, '');
	return positionValide(net);
}

/** Vrai si `declare` est `relatif` ou l'un de ses parents (frontière de dossier). */
function couvre(declare: string, relatif: string): boolean {
	const d = cleDeCasse(declare);
	const r = cleDeCasse(relatif);
	return r === d || r.startsWith(`${d}/`);
}

/** Vrai si la déclaration l'emporte : valeur plus longue, puis chemin de fiche plus court, puis ordre alphabétique. */
function meilleur(declare: string, fiche: string, courante: Declaration): boolean {
	if (declare.length !== courante.declare.length) return declare.length > courante.declare.length;
	if (fiche.length !== courante.fiche.length) return fiche.length < courante.fiche.length;
	return fiche < courante.fiche;
}

/** Une fiche de lieu qui déclare `dossier_projet` : la valeur déclarée et le chemin de la fiche. */
export type Declaration = { declare: string; fiche: string };

/** Déclarations `dossier_projet` des fiches de lieu (`estTypeDeLieu`), d'après l'index tel qu'il est. */
export async function declarationsDeDossier(dep: Dependances): Promise<Declaration[]> {
	const declarations: Declaration[] = [];
	for (const element of await dep.index.elements({ genres: ['fiche'] })) {
		const declare = element.dossierProjet ?? null;
		if (declare !== null && estTypeDeLieu(element.typeFiche)) declarations.push({ declare, fiche: element.chemin });
	}
	return declarations;
}

/** La déclaration qui couvre `chemin` (lui ou un de ses parents) ; la plus longue gagne ; null si aucune. */
export function lienDuDossier(declarations: readonly Declaration[], chemin: string): Declaration | null {
	let gagnante: Declaration | null = null;
	for (const d of declarations) {
		if (!couvre(d.declare, chemin)) continue;
		if (gagnante === null || meilleur(d.declare, d.fiche, gagnante)) gagnante = d;
	}
	return gagnante;
}

/**
 * Position d'un dossier de projet, et son `rattachement` : le dossier normalisé et s'il est couvert par une fiche ; null pour
 * la racine du dossier Mnemo ou un chemin invalide (rien à rattacher).
 */
export type PositionDuProjet = Position & { rattachement: { dossier: string; rattache: boolean } | null };

/**
 * Position, dans la mémoire, d'un dossier de projet Claude Code (`relatif` : chemin relatif à la racine Mnemo, séparé par « / ») :
 * la fiche de lieu dont `dossier_projet` est `relatif` ou un de ses parents (la valeur la plus longue gagne) ;
 * sinon la racine (« »). Le lien entre un dossier et la mémoire est posé par une fiche.
 * Synchronise l'index d'abord, sauf `sansSynchroniser` (hook `outil` : l'index tel qu'il est).
 */
export async function positionDuProjet(dep: Dependances, relatif: string, options: { sansSynchroniser?: boolean } = {}): Promise<PositionDuProjet> {
	const chemin = normaliser(relatif);
	if (chemin === null || chemin === '') return { chemin: '', rattachement: null };
	if (options.sansSynchroniser !== true) await synchroniser(dep, SANS_EXTRACTION);
	const lien = lienDuDossier(await declarationsDeDossier(dep), chemin);
	if (lien === null) return { chemin: '', rattachement: { dossier: chemin, rattache: false } };
	return { chemin: positionDeFiche(lien.fiche), rattachement: { dossier: chemin, rattache: true } };
}
