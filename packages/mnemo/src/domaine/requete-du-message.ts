// Requête du classement d'un message (spec classement vivant § 3.2) : le message seul, ou joint au message porteur d'avant de
// l'utilisateur s'il est court ou anaphorique (jamais une réponse de Claude). Le hook et le banc l'appliquent tous deux. Pur.
//
// La règle est celle qui a servi à figer les cas jugés du banc (variante `jointe`) : la changer rendrait ces cas faux.

import { ACQUIESCEMENTS } from './message-muet.ts';
import { motsUtiles } from './requete.ts';

/** `seule` : le message seul ; `jointe` : joint au message porteur d'avant s'il est court ou anaphorique. */
export type VarianteDeRequete = 'seule' | 'jointe';

/**
 * Variante de la requête du hook. Réglage interne, pas un réglage de l'utilisateur : le banc compare les deux variantes, et
 * `jointe` n'est gardée que si elle gagne (spec § 3.2). Tant qu'il ne l'a pas montré : le message seul.
 */
export const VARIANTE_DE_LA_REQUETE: VarianteDeRequete = 'seule';

/** Sous ce nombre de mots porteurs, un message est « court ». */
const MOTS_PORTEURS_COURT = 6;
/** Débuts anaphoriques (sans casse ; apostrophes droites ou typographiques). */
const RE_ANAPHORE = /^\s*(et\s+(pour|pour\s+le|pour\s+la|si|avec|sur|le|la|les|ça|ca)\b|pareil\b|idem\b|celle-ci\b|celui-ci\b|celles-ci\b|ceux-ci\b|celle-là\b|celui-là\b|ça\b|ca\b|cela\b|le\s+même\b|la\s+même\b|les\s+mêmes\b|même\s+chose\b|et\s+(l|d)['’])/iu;

/** Vrai si le message est court (moins de 6 mots porteurs) ou commence par un renvoi. */
export function estCourtOuAnaphorique(message: string): boolean {
	const porteurs = motsUtiles(message).filter((mot) => [...mot].length >= 3 && !ACQUIESCEMENTS.has(mot));
	return porteurs.length < MOTS_PORTEURS_COURT || RE_ANAPHORE.test(message);
}

/** Le message porteur d'avant puis le message, s'il est court ou anaphorique et qu'il y a un message d'avant ; sinon null (la même que le message seul). */
export function requeteJointe(message: string, precedent: string | null): string | null {
	if (precedent === null || precedent.trim() === '' || !estCourtOuAnaphorique(message)) return null;
	return `${precedent}\n${message}`;
}

/** Faut-il le message porteur d'avant pour former la requête de ce message ? Sinon, inutile de le lire. */
export function precedentUtile(message: string, variante: VarianteDeRequete = VARIANTE_DE_LA_REQUETE): boolean {
	return variante === 'jointe' && message.trim() !== '' && estCourtOuAnaphorique(message);
}

/** La requête du classement de ce message, selon la variante (par défaut, celle du hook). */
export function requeteDuMessage(message: string, precedent: string | null, variante: VarianteDeRequete = VARIANTE_DE_LA_REQUETE): string {
	return variante === 'jointe' ? (requeteJointe(message, precedent) ?? message) : message;
}
