/** Classement en direct d'une session (panneau Contexte) : le dernier calcul de `servir`, sans les écartés. */
import { SEUIL_NOTE_CLASSEMENT, type ClassementVue, type EntreeServieVue, type InjectionVue, type ReglagesVue } from '@mnemo/contrat';

/** Vrai si l'id est écarté : lui-même, ou sa fiche (un écarté sans `#`), comme le service. */
export function estEcarte(id: string, ecartes: readonly string[]): boolean {
	return ecartes.some((e) => id === e || (!e.includes('#') && id.startsWith(`${e}#`)));
}

/**
 * L'entrée porteuse la plus récente (message non muet), ou null : le panneau garde le classement du dernier message porteur
 * (spec § 3.1) ; une ➤ partie avec un message muet (« ok ») s'ajoute aux injectées sans effacer ses lignes.
 */
export function derniereEntree(entrees: readonly EntreeServieVue[]): EntreeServieVue | null {
	return entrees.reduce<EntreeServieVue | null>((a, e) => (e.muet === null && (a === null || e.horodatageMs > a.horodatageMs) ? e : a), null);
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

/**
 * Le classement est-il calibré (une note apprise et acceptée donne des %) ? Seulement si l'entrée le dit : une entrée ancienne,
 * ou en ordre seul, n'affiche aucun %.
 */
export function estCalibre(entree: EntreeServieVue | null): boolean {
	return entree?.calibree === true;
}

/** Seuil d'injection automatique par défaut (réglage `contexte.seuilInjection`, en %). */
export const SEUIL_INJECTION_DEFAUT = 90;

/** Le seuil d'injection automatique des réglages, de 0 à 1 ; le défaut sans réglages lus. */
export function seuilInjection(reglages: ReglagesVue | undefined): number {
	const v = reglages?.champs.find((c) => c.cle === 'contexte.seuilInjection')?.valeur;
	return (typeof v === 'number' ? v : SEUIL_INJECTION_DEFAUT) / 100;
}

/** Comment une fiche est arrivée entière dans la session : à la main (➤), ou par Mnemo avec sa note de confiance. */
export type ModeInjection = { mode: 'main' | 'auto'; horodatageMs: number; p?: number };

/**
 * Le mode d'injection de chaque fiche (chemin → mode) : le journal des gestes rendu par le service (`injections`), complété par
 * les lignes `auto` des classements reçus depuis. La plus récente injection d'une fiche l'emporte. `premieres` : la note d'une
 * ligne `auto` vue en premier (au hook, celle qui l'a fait injecter), par message et fiche, gardée par l'appelant d'un rendu à
 * l'autre : l'affinage qui change ensuite la note de la ligne ne change pas celle de l'injection.
 */
export function modesDInjection(injections: readonly InjectionVue[], entrees: readonly EntreeServieVue[], premieres: Map<string, number> = new Map()): Map<string, ModeInjection> {
	const toutes: (ModeInjection & { chemin: string })[] = [];
	for (const e of entrees) {
		for (const c of e.classement) {
			if (c.auto !== true) continue;
			const chemin = c.id.split('#')[0]!;
			const cle = `${e.horodatageMs}|${chemin}`;
			if (!premieres.has(cle) && typeof c.p === 'number') premieres.set(cle, c.p);
			const p = premieres.get(cle);
			toutes.push({ chemin, mode: 'auto', horodatageMs: e.horodatageMs, ...(p === undefined ? {} : { p }) });
		}
	}
	// au même message, le journal l'emporte : il garde la note du hook, que l'affinage a pu changer ensuite sur la ligne
	toutes.push(...injections);
	const modes = new Map<string, ModeInjection>();
	for (const { chemin, ...m } of toutes.sort((a, b) => a.horodatageMs - b.horodatageMs)) modes.set(chemin, m);
	return modes;
}
