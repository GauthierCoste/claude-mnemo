import { motsUtiles } from './requete.ts';

/** Pourquoi un message ne déclenche aucun calcul de contexte : il commence par une balise, ou il ne porte pas de sens. */
export type RaisonMuet = 'balise' | 'sans_contenu';

/** Acquiescements (sans accents) : « vas-y, pousse » ne demande aucun fait. */
export const ACQUIESCEMENTS: ReadonlySet<string> = new Set([
	'oui', 'non', 'merci', 'vas', 'pousse', 'pousser', 'continue', 'go', 'parfait', 'daccord', 'accord', 'fais', 'fait', 'valide', 'top', 'nickel',
]);

const RE_BALISE = /^\s*<[a-z][^>]*>/i;
const RE_COLLE = /^\s*<pasted_content/i;
const MOTS_PORTEURS_MIN = 2;

/** Vrai pour un message injecté par l'outil (notification, commande…), faux pour un contenu collé par l'utilisateur. */
export function commenceParUneBalise(message: string): boolean {
	return RE_BALISE.test(message) && !RE_COLLE.test(message);
}

/** Raison pour laquelle le message est muet, ou `null` s'il porte du sens : moins de 2 mots de 3 lettres ou plus hors mots vides et acquiescements. */
export function raisonDeMutisme(message: string): RaisonMuet | null {
	if (commenceParUneBalise(message)) return 'balise';
	const porteurs = motsUtiles(message).filter((mot) => [...mot].length >= 3 && !ACQUIESCEMENTS.has(mot));
	return porteurs.length < MOTS_PORTEURS_MIN ? 'sans_contenu' : null;
}
