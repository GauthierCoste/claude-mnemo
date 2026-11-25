// Requête du classement d'un message (spec classement vivant § 3.2) : le message seul, ou joint au message porteur d'avant de
// l'utilisateur s'il est court ou anaphorique (jamais une réponse de Claude). Le hook et le banc l'appliquent tous deux. Pur.
//
// La règle est celle qui a servi à figer les cas jugés du banc (variante `jointe`) : la changer rendrait ces cas faux.

import { ACQUIESCEMENTS, raisonDeMutisme } from './message-muet.ts';
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

/** Au-delà de cet écart avec le message, le message porteur d'avant ne parle plus de la même chose : pas de requête jointe. */
export const ECART_MAX_DU_PRECEDENT_MS = 30 * 60_000;
/** Entrées du journal (les plus récentes avant le message) où chercher le message porteur d'avant : le hook et le banc. */
export const ENTREES_DU_PRECEDENT = 20;

/** Ce que le choix du message d'avant lit d'une entrée du journal. */
export type EntreePourLePrecedent = { moment: string; horodatageMs: number; demande: string | null; muet: string | null };

/**
 * Le message porteur d'avant de l'utilisateur, pour un message à `instantMs` (spec § 3.2) : parmi les `ENTREES_DU_PRECEDENT`
 * entrées du journal qui le précèdent, la demande de la plus récente entrée `message` porteuse (non muette, non vide), à
 * `ECART_MAX_DU_PRECEDENT_MS` au plus ; la recherche s'arrête à une remise à zéro journalisée (entrée `debut`) : après un
 * `/clear`, Claude ne voit plus l'échange d'avant. Null s'il n'y en a pas. Jamais une réponse de Claude : le journal n'en a pas.
 */
export function messagePrecedent(entrees: readonly EntreePourLePrecedent[], instantMs: number): string | null {
	const avant = entrees
		.filter((e) => e.horodatageMs < instantMs)
		.sort((a, b) => b.horodatageMs - a.horodatageMs)
		.slice(0, ENTREES_DU_PRECEDENT);
	for (const e of avant) {
		if (e.moment === 'debut' || instantMs - e.horodatageMs > ECART_MAX_DU_PRECEDENT_MS) return null;
		if (e.moment !== 'message' || e.muet !== null || e.demande === null || e.demande.trim() === '' || raisonDeMutisme(e.demande) !== null) continue;
		return e.demande;
	}
	return null;
}
