/**
 * Phrase d'effet sous les curseurs principaux de l'onglet Réglages : ce que la valeur choisie fait, en une phrase, mise à
 * jour pendant qu'on fait glisser. `valeurDe` lit la valeur saisie d'un autre champ (les pistes dépendent du seuil d'injection).
 */

type Phrase = (n: number, valeurDe: (cle: string) => number | undefined) => string;

const pluriel = (n: number, mot: string): string => `${n} ${mot}${n > 1 ? 's' : ''}`;

const PHRASES: Readonly<Record<string, Phrase>> = {
	'contexte.seuilInjection': (n) =>
		n >= 100 ? 'Jamais d’injection automatique.' : n >= 95 ? 'Seulement les fiches presque certaines.' : n >= 85 ? 'Les fiches très sûres entrent seules.' : 'Mnemo injecte généreusement.',
	'contexte.injectionsParMessage': (n) => (n === 0 ? 'Rien n’entre sans ton geste.' : `Jusqu’à ${pluriel(n, 'fiche')} par message.`),
	'contexte.seuilPiste': (n, valeurDe) => {
		const injection = valeurDe('contexte.seuilInjection');
		if (injection !== undefined && n > injection) return `Au-dessus du seuil d’injection (${injection} %) : refusé à l’enregistrement.`;
		return n <= 5 ? 'Presque tout peut devenir une piste.' : n >= 50 ? 'Seules les pistes solides sont proposées.' : 'Les pistes plausibles sont proposées.';
	},
	'contexte.pistesParMessage': (n) => (n === 0 ? 'Aucune piste.' : `${pluriel(n, 'carte')} à injecter d’un geste.`),
	'modeles.inactiviteMinutes': (n) =>
		n <= 5 ? 'Économes : ils redémarrent souvent, et la recherche attend alors leur réveil.' : n >= 40 ? 'Toujours prêts, mais environ 1,6 Go de mémoire vive occupés longtemps.' : 'Un bon équilibre.',
};

/** La phrase d'effet du champ `cle` pour la valeur `n` ; null : ce champ n'en a pas. */
export function phraseEffet(cle: string, n: number, valeurDe: (cle: string) => number | undefined): string | null {
	return PHRASES[cle]?.(n, valeurDe) ?? null;
}
