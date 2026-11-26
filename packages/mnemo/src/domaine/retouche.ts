// Une retouche d'information change la forme, jamais le sens. Pur, sans module `node:`.

/** Énoncé d'une information : son texte et sa catégorie. */
export type Enonce = { texte: string; categorie?: string };

/**
 * Écart de texte (distance d'édition, sur le texte comparé : minuscules, sans accents, blancs réduits) au-delà duquel une
 * retouche n'est plus de forme : 20 % de la longueur du plus long texte, au moins 2, au plus 8. Une coquille, une lettre
 * d'un nom (« Corbano » → « Cordano »), une ponctuation, un mot mal tapé passent ; remplacer un nom par un autre ou réécrire
 * une phrase ne passe pas.
 */
export const DISTANCE_MAX_RETOUCHE = 8;
const PART_MAX_RETOUCHE = 0.2;
const DISTANCE_MIN_RETOUCHE = 2;

/**
 * Mots qui portent le sens d'une date, d'une durée, d'un montant, d'une borne ou d'une négation : leur suite doit rester la
 * même.
 */
const MOTS_DE_SENS: ReadonlySet<string> = new Set([
	// mois et jours
	'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre',
	'janv', 'fevr', 'avr', 'juil', 'sept', 'oct', 'nov', 'dec',
	'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche',
	// durées
	'seconde', 'secondes', 'minute', 'minutes', 'heure', 'heures', 'jour', 'jours', 'journee', 'journees', 'semaine', 'semaines',
	'mois', 'an', 'ans', 'annee', 'annees', 'trimestre', 'trimestres', 'semestre', 'semestres', 'siecle', 'siecles',
	// nombres en lettres (« un » et « une » sont aussi des articles : pas comptés)
	'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze',
	'seize', 'vingt', 'vingts', 'trente', 'quarante', 'cinquante', 'soixante', 'cent', 'cents', 'mille', 'million', 'millions',
	'milliard', 'milliards', 'demi', 'moitie', 'quart', 'tiers', 'double', 'triple', 'premier', 'premiere', 'dernier', 'derniere',
	// montants (« M€ », « Md€ »…)
	'euro', 'euros', 'eur', 'dollar', 'dollars', 'usd', 'livre', 'livres', 'gbp', 'chf', 'ht', 'ttc', 'k', 'keur', 'm', 'md', 'mds', 'mrd',
	// bornes et comparaisons
	'avant', 'apres', 'depuis', 'jusqu', 'jusque', 'plus', 'moins', 'minimum', 'maximum', 'min', 'max',
	'inclus', 'incluse', 'inclusivement', 'exclus', 'exclue', 'sauf', 'hors',
	// négation
	'ne', 'n', 'pas', 'jamais', 'aucun', 'aucune', 'non', 'sans', 'ni', 'rien',
]);
/**
 * Une marque de sens dans le texte comparé (blancs réduits à une espace) : un nombre (chiffres, séparateurs de milliers par
 * une espace suivie de trois chiffres, partie décimale), un symbole qui change sa valeur, ou un mot.
 */
const RE_MARQUE = /(\d+(?: \d{3}(?!\d))*(?:[.,]\d+)?)|([€$£%‰])|(\p{L}+)/gu;

const sansAccents = (texte: string): string => texte.normalize('NFD').replace(/\p{M}/gu, '');
const compare = (texte: string): string => sansAccents(texte).toLowerCase().replace(/\s+/gu, ' ').trim();

/** Un nombre écrit sans séparateur de milliers, virgule décimale en point, sans zéro en tête. */
function nombreNormalise(brut: string): string {
	const [entier, decimale] = brut.replace(/ /gu, '').replace(',', '.').split('.');
	const tete = entier!.replace(/^0+(?=\d)/u, '');
	return decimale === undefined ? tete : `${tete}.${decimale}`;
}

/**
 * Nombres, symboles et mots de sens du texte, dans l'ordre : deux textes de même sens ont la même suite (deux nombres
 * permutés, « 2026-03-04 » → « 2026-04-03 », changent le sens).
 */
function marquesDeSens(texte: string): string[] {
	const marques: string[] = [];
	for (const [, nombre, symbole, mot] of compare(texte).matchAll(RE_MARQUE)) {
		if (nombre !== undefined) marques.push(`#${nombreNormalise(nombre)}`);
		else if (symbole !== undefined) marques.push(symbole);
		else if (mot !== undefined && MOTS_DE_SENS.has(mot)) marques.push(mot);
	}
	return marques;
}

/** Distance d'édition (insertion, suppression, substitution) ; s'arrête dès qu'elle dépasse `max` (rend `max + 1`). */
export function distanceDEdition(a: string, b: string, max = Infinity): number {
	if (Math.abs(a.length - b.length) > max) return max + 1;
	let precedente = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const courante = [i];
		let minimum = i;
		for (let j = 1; j <= b.length; j++) {
			const valeur = Math.min(precedente[j]! + 1, courante[j - 1]! + 1, precedente[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
			courante.push(valeur);
			if (valeur < minimum) minimum = valeur;
		}
		if (minimum > max) return max + 1;
		precedente = courante;
	}
	return precedente[b.length]!;
}

/** Écart de texte permis pour un texte comparé de cette longueur. */
export function distancePermise(longueur: number): number {
	return Math.min(DISTANCE_MAX_RETOUCHE, Math.max(DISTANCE_MIN_RETOUCHE, Math.floor(longueur * PART_MAX_RETOUCHE)));
}

const CONSEIL = 'Pour changer le sens d\'une information, utiliser `proposer` (genre `fait`) avec `remplace` : l\'ancienne est barrée, la nouvelle garde son historique.';

/**
 * Motif du refus si la retouche `avant` → `apres` change le sens de l'information, sinon null : un nombre, une date, une
 * durée, un montant, une borne ou une négation diffère ou change de place (suite des nombres, symboles €, $, %, mois,
 * unités de durée, nombres en lettres, abréviations de montant, bornes comme avant, après, minimum, inclus, sauf,
 * négations), la catégorie change en entrant dans `categoriesAEnjeu`, en en sortant ou de l'une à l'autre,
 * ou l'écart de texte dépasse `distancePermise`. Le motif dit d'utiliser `proposer` avec `remplace`.
 */
export function retoucheDeSens(avant: Enonce, apres: Enonce, categoriesAEnjeu: readonly string[]): string | null {
	if (avant.categorie !== apres.categorie && [avant.categorie, apres.categorie].some((c) => c !== undefined && categoriesAEnjeu.includes(c))) {
		return `Changer la catégorie de « ${avant.categorie ?? 'aucune'} » à « ${apres.categorie ?? 'aucune'} » touche une catégorie à fort enjeu (${categoriesAEnjeu.join(', ')}) : c'est un changement de sens. ${CONSEIL}`;
	}
	const marquesAvant = marquesDeSens(avant.texte);
	const marquesApres = marquesDeSens(apres.texte);
	if (marquesAvant.length !== marquesApres.length || marquesAvant.some((m, i) => m !== marquesApres[i])) {
		return `La retouche change, ajoute, retire ou déplace un nombre, une date, une durée, un montant, une borne ou une négation : c'est un changement de sens. ${CONSEIL}`;
	}
	const a = compare(avant.texte);
	const b = compare(apres.texte);
	const permise = distancePermise(Math.max(a.length, b.length));
	if (distanceDEdition(a, b, permise) > permise) {
		return `La retouche change le texte au-delà d'une correction de forme (coquille, nom, ponctuation : ${permise} caractères au plus ici) : c'est un changement de sens. ${CONSEIL}`;
	}
	return null;
}
