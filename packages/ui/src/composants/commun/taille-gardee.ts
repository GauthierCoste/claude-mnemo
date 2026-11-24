/**
 * Taille réglable d'un panneau (largeur d'un tiroir, hauteur d'une partie), gardée par visiteur dans `localStorage` au
 * mieux : sans stockage (navigation privée, stockage bloqué), elle vaut pour la visite seulement.
 */
import { useState } from 'react';

export interface TailleGardee {
	/** Clé dans `localStorage`. */
	cle: string;
	defaut: number;
	min: number;
}

/** Part de la fenêtre qu'un panneau latéral ne dépasse jamais. */
export const PART_MAX_PANNEAU = 0.4;

/** Largeur maximale d'un panneau latéral dans la fenêtre courante (jamais sous `min`). */
export function largeurMaxPanneau(min: number): number {
	return Math.max(min, Math.floor(window.innerWidth * PART_MAX_PANNEAU));
}

/** `px` arrondi et ramené entre `min` et `max` (`max` ne descend jamais sous `min`). */
export function borner(px: number, min: number, max: number): number {
	return Math.round(Math.min(Math.max(min, max), Math.max(min, px)));
}

/** Valeur gardée sous `cle`, ou null (absente, ou stockage indisponible). */
export function lireGarde(cle: string): string | null {
	try {
		return window.localStorage.getItem(cle);
	} catch {
		return null;
	}
}

/** Garde `valeur` sous `cle` ; null l'efface. */
export function garder(cle: string, valeur: string | null): void {
	try {
		if (valeur === null) window.localStorage.removeItem(cle);
		else window.localStorage.setItem(cle, valeur);
	} catch {
		/* stockage indisponible : la valeur vaut pour cette visite seulement */
	}
}

function lireTaille(t: TailleGardee, max: number): number {
	const n = Number(lireGarde(t.cle) ?? Number.NaN);
	return borner(Number.isFinite(n) && n > 0 ? n : t.defaut, t.min, max);
}

/**
 * Taille courante, relue au montage et toujours bornée par `max` (relu à chaque rendu : la fenêtre change). `regler`
 * la change (gardée si `garderAussi`, faux pendant un glissement) ; `reinitialiser` revient au défaut et oublie la valeur.
 */
export function useTailleGardee(
	t: TailleGardee,
	max: number,
): { valeur: number; regler(px: number, garderAussi?: boolean): void; reinitialiser(): void } {
	const [brute, setBrute] = useState(() => lireTaille(t, max));
	return {
		valeur: borner(brute, t.min, max),
		regler(px, garderAussi = true) {
			const b = borner(px, t.min, max);
			setBrute(b);
			if (garderAussi) garder(t.cle, String(b));
		},
		reinitialiser() {
			setBrute(t.defaut);
			garder(t.cle, null);
		},
	};
}
