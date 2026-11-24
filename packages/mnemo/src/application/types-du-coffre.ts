import type { Dependances } from './ports.ts';
import { estTypeReserve, TYPES_RESERVES } from '../domaine/fiche.ts';
import type { TypeFiche } from '../domaine/fiche.ts';

export type TypeEmploye = { type: TypeFiche; fiches: number };

/** Types de fiche du coffre, dérivés des fiches indexées : par nombre de fiches décroissant, puis par nom. */
export async function typesDuCoffre(dep: Pick<Dependances, 'index'>): Promise<TypeEmploye[]> {
	const compte = new Map<TypeFiche, number>();
	for (const element of await dep.index.elements({ genres: ['fiche'] })) {
		compte.set(element.typeFiche, (compte.get(element.typeFiche) ?? 0) + 1);
	}
	return [...compte]
		.map(([type, fiches]) => ({ type, fiches }))
		.sort((a, b) => b.fiches - a.fiches || a.type.localeCompare(b.type));
}

/**
 * Choix du réglage « Types de fiche à confirmer » : les types du coffre sauf `profil` (un profil ne reçoit pas d'information
 * par `proposer`), plus les types déjà cochés que plus aucune fiche ne porte.
 */
export async function choixDesTypesAConfirmer(dep: Pick<Dependances, 'index'>, coches: readonly string[]): Promise<{ valeur: string; libelle: string }[]> {
	const employes = (await typesDuCoffre(dep)).map((t) => t.type).filter((t) => t !== 'profil');
	const orphelins = coches.filter((t) => !employes.includes(t)).sort((a, b) => a.localeCompare(b));
	return [...employes, ...orphelins].map((t) => ({ valeur: t, libelle: t }));
}

/** Types libres cités à Claude dans la description de `proposer` : les plus employés. */
export const TYPES_LIBRES_CITES = 10;

/** Phrase des types de fiche pour Claude : les réservés, puis les types libres les plus employés du coffre. */
export function phraseDesTypes(types: readonly TypeEmploye[]): string {
	const libres = types.filter((t) => !estTypeReserve(t.type)).slice(0, TYPES_LIBRES_CITES);
	const enUsage = libres.length === 0 ? 'aucun pour l’instant' : libres.map((t) => `${t.type} (${t.fiches})`).join(', ');
	return `Types de fiche : réservés ${TYPES_RESERVES.join(', ')} ; libres déjà employés : ${enUsage}. Réutilise un type employé avant d'en créer un.`;
}
