/**
 * Phrase d'effet sous les curseurs principaux de l'onglet Réglages : ce que la valeur choisie fait, en une phrase, mise à
 * jour pendant qu'on fait glisser. `valeurDe` lit la valeur saisie d'un autre champ (les pistes dépendent du seuil d'injection).
 */

import type { NoteDuNiveauVue } from '@mnemo/contrat';

type Phrase = (n: number, valeurDe: (cle: string) => number | undefined) => string;

const pluriel = (n: number, mot: string): string => `${n} ${mot}${n > 1 ? 's' : ''}`;

const PHRASES: Readonly<Record<string, Phrase>> = {
	'contexte.seuilInjection': (n) =>
		n >= 100 ? 'Jamais d’injection automatique.' : n >= 95 ? 'Seulement les fiches presque certaines.' : n >= 85 ? 'Les fiches très sûres entrent seules.' : 'Mnemo injecte généreusement.',
	'contexte.injectionsParMessage': (n) => (n === 0 ? 'Rien n’entre sans un geste.' : `Jusqu’à ${pluriel(n, 'fiche')} par message.`),
	'contexte.seuilPiste': (n, valeurDe) => {
		const injection = valeurDe('contexte.seuilInjection');
		if (injection !== undefined && n > injection) return `Au-dessus du seuil d’injection (${injection} %) : refusé à l’enregistrement.`;
		return n <= 5 ? 'Presque tout peut devenir une piste.' : n >= 50 ? 'Seules les pistes solides sont proposées.' : 'Les pistes plausibles sont proposées.';
	},
	'contexte.pistesParMessage': (n) => (n === 0 ? 'Aucune piste.' : `${pluriel(n, 'carte')} à injecter d’un geste.`),
	'modeles.inactiviteMinutes': (n) =>
		n <= 5 ? 'Économes : ils redémarrent souvent, et la recherche attend alors leur réveil.' : n >= 40 ? 'Toujours prêts, mais environ 1,6 Go de mémoire vive occupés longtemps.' : 'Un bon équilibre.',
};

/**
 * Ce que le seuil d'injection fait vraiment aujourd'hui, selon la note de confiance (`niveaux` : état et seuil mesuré de chaque
 * niveau) ; null : rien à dire (jamais d'injection, état inconnu, ou note acceptée mesurée à ce seuil). Une note refusée ne
 * donne pas de % : rien n'est injecté seul, quel que soit le seuil. Une note acceptée mesurée à un autre seuil injecte à
 * celui-ci sans y avoir été mesurée.
 */
export function remarqueSeuilInjection(n: number, niveaux: readonly Pick<NoteDuNiveauVue, 'etat' | 'seuil'>[] | undefined): string | null {
	if (n >= 100 || niveaux === undefined) return null;
	const acceptes = niveaux.filter((x) => x.etat === 'accepte');
	if (acceptes.length === 0) return 'Sans effet pour l’instant : la note de confiance n’est pas encore acceptée (Mémoire › Entraîner).';
	const mesure = acceptes.find((x) => x.seuil !== null && Math.round(x.seuil * 100) !== n)?.seuil;
	return mesure === undefined || mesure === null ? null : `Note mesurée à ${Math.round(mesure * 100)} % : la réapprendre pour la mesurer à ${n} %.`;
}

/** La phrase d'effet du champ `cle` pour la valeur `n` ; null : ce champ n'en a pas. */
export function phraseEffet(cle: string, n: number, valeurDe: (cle: string) => number | undefined): string | null {
	return PHRASES[cle]?.(n, valeurDe) ?? null;
}
