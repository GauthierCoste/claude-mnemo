// Règle PROVISOIRE de la requête jointe (spec classement vivant § 3.2), pour le banc seulement : remplacée par celle de T4
// (`domaine/requete-du-message.ts`). Elle sert à figer dès la première extraction les fiches de la variante jointe. Pur.

import { ACQUIESCEMENTS } from './message-muet.ts';
import { motsUtiles } from './requete.ts';

/** Sous ce nombre de mots porteurs, un message est « court ». */
const MOTS_PORTEURS_COURT = 6;
/** Débuts anaphoriques (sans casse ; apostrophes droites ou typographiques). */
const RE_ANAPHORE = /^\s*(et\s+(pour|pour\s+le|pour\s+la|si|avec|sur|le|la|les|ça|ca)\b|pareil\b|idem\b|celle-ci\b|celui-ci\b|celles-ci\b|ceux-ci\b|celle-là\b|celui-là\b|ça\b|ca\b|cela\b|le\s+même\b|la\s+même\b|les\s+mêmes\b|même\s+chose\b|et\s+(l|d)['’])/iu;

/** Vrai si le message est court (moins de 6 mots porteurs) ou commence par un renvoi. */
export function estCourtOuAnaphorique(message: string): boolean {
	const porteurs = motsUtiles(message).filter((mot) => [...mot].length >= 3 && !ACQUIESCEMENTS.has(mot));
	return porteurs.length < MOTS_PORTEURS_COURT || RE_ANAPHORE.test(message);
}

/** Le message porteur d'avant puis le message, s'il est court ou anaphorique et qu'il y a un message d'avant ; sinon null. */
export function requeteJointeProvisoire(message: string, precedent: string | null): string | null {
	if (precedent === null || precedent.trim() === '' || !estCourtOuAnaphorique(message)) return null;
	return `${precedent}\n${message}`;
}
