import type { Langue } from '@mnemo/commun';

const REGLES: Record<Langue, Intl.PluralRules> = { fr: new Intl.PluralRules('fr'), en: new Intl.PluralRules('en') };

/**
 * La forme d'un mot selon le nombre et les règles de la langue : en français 0 et 1 sont au singulier, en anglais seul 1
 * l'est. `autre` sert à toute catégorie que la langue distingue en plus.
 */
export function pluriel(langue: Langue, n: number, formes: { un: string; autre: string }): string {
	return REGLES[langue].select(n) === 'one' ? formes.un : formes.autre;
}
