/** Classement en direct d'une session (panneau Contexte) : le dernier calcul de `servir`, sans les écartés. */
import { SEUIL_NOTE_CLASSEMENT, type ClassementVue, type EntreeServieVue } from '@mnemo/contrat';

/** Vrai si l'id est écarté : lui-même, ou sa fiche (un écarté sans `#`), comme le service. */
export function estEcarte(id: string, ecartes: readonly string[]): boolean {
	return ecartes.some((e) => id === e || (!e.includes('#') && id.startsWith(`${e}#`)));
}

/** L'entrée la plus récente, ou null. */
export function derniereEntree(entrees: readonly EntreeServieVue[]): EntreeServieVue | null {
	return entrees.reduce<EntreeServieVue | null>((a, e) => (a === null || e.horodatageMs > a.horodatageMs ? e : a), null);
}

/**
 * Classement de l'entrée la plus récente, une ligne par fiche. Avec des notes : par note décroissante (le pourcentage est
 * l'ordre), les lignes sans note ensuite, par rang ; sans notes : par rang. Masqués : les écartés (le service ne les classe
 * plus ; l'entrée affichée a pu précéder le geste) et les fiches notées sous `SEUIL_NOTE_CLASSEMENT`, sauf si elles ont été
 * servies (ce que l'agent a reçu reste toujours visible).
 */
export function dernierClassement(entrees: readonly EntreeServieVue[], ecartes: readonly string[]): ClassementVue[] {
	return classementTrie(entrees).filter((c) => auDessusDuSeuil(c) && !estEcarte(c.id, ecartes));
}

/** Les fiches que `dernierClassement` masque par le seuil (ni servies, ni écartées), dans le même ordre : dites à part. */
export function sousLeSeuil(entrees: readonly EntreeServieVue[], ecartes: readonly string[]): ClassementVue[] {
	return classementTrie(entrees).filter((c) => !auDessusDuSeuil(c) && !estEcarte(c.id, ecartes));
}

const auDessusDuSeuil = (c: ClassementVue): boolean => c.servi || c.note === null || c.note >= SEUIL_NOTE_CLASSEMENT;

function classementTrie(entrees: readonly EntreeServieVue[]): ClassementVue[] {
	const derniere = derniereEntree(entrees);
	if (derniere === null) return [];
	const cle = (c: ClassementVue) => (c.note === null ? -1 : c.note);
	return [...derniere.classement].sort((a, b) => cle(b) - cle(a) || a.rang - b.rang);
}

/** « 87 % » (pourcentage entier, espace insécable) ; null sans note. Une note de piste peut dépasser 1 (sens plus poids) : 100 %. */
export function pourcentage(note: number | null): string | null {
	return note === null ? null : `${Math.round(Math.min(note, 1) * 100)} %`;
}
