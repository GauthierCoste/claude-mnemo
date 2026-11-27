/**
 * Phrase d'effet sous les curseurs principaux de l'onglet Réglages : ce que la valeur choisie fait, en une phrase, mise à
 * jour pendant qu'on fait glisser. `valeurDe` lit la valeur saisie d'un autre champ (les pistes dépendent du seuil d'injection).
 */

import type { NoteDuNiveauVue } from '@mnemo/contrat';
import { TEXTES, type Textes } from '../langue/textes.ts';

type Phrase = (n: number, valeurDe: (cle: string) => number | undefined) => string;

function phrases(t: Textes): Readonly<Record<string, Phrase>> {
	const e = t.reglages.effets;
	return {
		'contexte.seuilInjection': (n) =>
			n >= 100 ? e.seuilInjection.jamais : n >= 95 ? e.seuilInjection.presqueCertaines : n >= 85 ? e.seuilInjection.tresSures : e.seuilInjection.genereux,
		'contexte.injectionsParMessage': (n) => (n === 0 ? e.injectionsParMessage.aucune : e.injectionsParMessage.jusqua(n)),
		'contexte.seuilPiste': (n, valeurDe) => {
			const injection = valeurDe('contexte.seuilInjection');
			if (injection !== undefined && n > injection) return e.seuilPiste.auDessus(injection);
			return n <= 5 ? e.seuilPiste.presqueTout : n >= 50 ? e.seuilPiste.solides : e.seuilPiste.plausibles;
		},
		'contexte.pistesParMessage': (n) => (n === 0 ? e.pistesParMessage.aucune : e.pistesParMessage.cartes(n)),
		'modeles.inactiviteMinutes': (n) => (n <= 5 ? e.inactiviteMinutes.econes : n >= 40 ? e.inactiviteMinutes.toujoursPrets : e.inactiviteMinutes.equilibre),
	};
}

/**
 * Ce que le seuil d'injection fait vraiment aujourd'hui, selon la note de confiance (`niveaux` : état et seuil mesuré de chaque
 * niveau) ; null : rien à dire (jamais d'injection, état inconnu, ou note acceptée mesurée à ce seuil). Une note refusée ne
 * donne pas de % : rien n'est injecté seul, quel que soit le seuil. Une note acceptée mesurée à un autre seuil injecte à
 * celui-ci sans y avoir été mesurée.
 */
export function remarqueSeuilInjection(n: number, niveaux: readonly Pick<NoteDuNiveauVue, 'etat' | 'seuil'>[] | undefined, t: Textes = TEXTES.fr): string | null {
	if (n >= 100 || niveaux === undefined) return null;
	const acceptes = niveaux.filter((x) => x.etat === 'accepte');
	if (acceptes.length === 0) return t.reglages.effets.remarqueSeuil.sansEffet;
	const mesure = acceptes.find((x) => x.seuil !== null && Math.round(x.seuil * 100) !== n)?.seuil;
	return mesure === undefined || mesure === null ? null : t.reglages.effets.remarqueSeuil.mesuree(Math.round(mesure * 100), n);
}

/** La phrase d'effet du champ `cle` pour la valeur `n` ; null : ce champ n'en a pas. */
export function phraseEffet(cle: string, n: number, valeurDe: (cle: string) => number | undefined, t: Textes = TEXTES.fr): string | null {
	return phrases(t)[cle]?.(n, valeurDe) ?? null;
}
