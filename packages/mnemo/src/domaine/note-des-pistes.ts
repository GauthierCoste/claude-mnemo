// Note unique des pistes (cartes candidates) : `note = base + Σ poids`. Pur.
//
// La base dit ce que le message (ou la question) désigne : la similarité de sens, de 0 à 1 (0 sans modèle). Chaque signal
// ajoute un poids, en fraction (25 points = 0,25), calculé par une fonction pure à partir de ce que la session a fait. Un
// nouveau signal s'ajoute à la liste passée à `noter`, sous son nom : le nom est la raison de la carte qu'il a portée. Les
// signaux ne filtrent rien : ils font monter des fiches dans un classement unique (un seuil de sens porte sur la base seule).

import type { RaisonCarte } from '@mnemo/commun';
import { sigmoide } from './contexte-score.ts';

/** Nom d'un signal : une raison de carte (celle d'une carte que ce signal a portée). */
export type NomSignal = Extract<RaisonCarte, 'liee'>;

/** Ce qu'un signal ajoute à la note d'une fiche ; `depuis` : la fiche d'où vient le poids (pour la raison affichée), s'il y en a une. */
export type Apport = { signal: NomSignal; poids: number; depuis: string | null };

export type Signal = {
	nom: NomSignal;
	/** Ce que le signal ajoute à la note de la fiche ; null : rien. */
	apport(chemin: string): Apport | null;
	/** Fiches que le signal désigne : candidates même hors du périmètre de la position (comme une fiche nommée). */
	designees: ReadonlySet<string>;
};

export type Note = { chemin: string; base: number; apports: readonly Apport[]; total: number };

export function noter(chemin: string, base: number, signaux: readonly Signal[]): Note {
	const apports: Apport[] = [];
	for (const signal of signaux) {
		const apport = signal.apport(chemin);
		if (apport !== null && apport.poids > 0) apports.push(apport);
	}
	return { chemin, base, apports, total: apports.reduce((somme, a) => somme + a.poids, base) };
}

/** Note décroissante, puis `departage` (un ordre total : le classement ne dépend jamais de l'ordre d'arrivée). */
export function classer(notes: readonly Note[], departage: (a: Note, b: Note) => number): Note[] {
	return [...notes].sort((a, b) => b.total - a.total || departage(a, b));
}

/** Fiches désignées par l'un des signaux. */
export function designees(signaux: readonly Signal[]): Set<string> {
	return new Set(signaux.flatMap((s) => [...s.designees]));
}

/** L'apport le plus fort de la note (le premier à égalité) ; null : aucun signal. */
export function apportPrincipal(note: Note): Apport | null {
	let fort: Apport | null = null;
	for (const a of note.apports) if (fort === null || a.poids > fort.poids) fort = a;
	return fort;
}

/**
 * Le signal qui pèse le plus dans la note, s'il pèse plus que la base : c'est lui qui a fait monter la fiche, il donne la raison
 * de la carte. Null : la base (le sens du message) l'emporte, ou aucun signal.
 */
export function signalDominant(note: Note): Apport | null {
	const fort = apportPrincipal(note);
	return fort !== null && fort.poids > note.base ? fort : null;
}

/**
 * Base d'une fiche notée par le reranker : sa note brute (un logit, llama.cpp ne le ramène pas dans [0, 1]) passée par la
 * sigmoïde. Échelle absolue : la base d'une fiche ne dépend ni du nombre de candidates ni des notes des autres, et se compare
 * aux poids des signaux comme une similarité de sens.
 */
export function baseDuReranker(note: number): number {
	return sigmoide(note);
}
