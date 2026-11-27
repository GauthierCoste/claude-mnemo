/** Langues de l'interface ; le français est la langue de référence des textes. */
export const LANGUES = ['fr', 'en'] as const;
export type Langue = (typeof LANGUES)[number];

/** Valeur du réglage `interface.langue` : une langue, ou `systeme` (celle du système, résolue par l'interface). */
export const CHOIX_LANGUE = ['systeme', ...LANGUES] as const;
export type ChoixLangue = (typeof CHOIX_LANGUE)[number];

export const LANGUE_DE_REPLI: Langue = 'en';

export const estLangue = (v: unknown): v is Langue => typeof v === 'string' && (LANGUES as readonly string[]).includes(v);
export const estChoixLangue = (v: unknown): v is ChoixLangue => typeof v === 'string' && (CHOIX_LANGUE as readonly string[]).includes(v);

/** Langue d'une étiquette BCP 47 du système (« fr-FR », « en-US ») : sa langue si l'interface la connaît, sinon l'anglais. */
export function langueDuSysteme(etiquette: string | null | undefined): Langue {
	const premiere = (etiquette ?? '').trim().toLowerCase().split(/[-_]/u)[0];
	return estLangue(premiere) ? premiere : LANGUE_DE_REPLI;
}

/** La langue à montrer pour un choix du réglage : `systeme` suit l'étiquette du système. */
export function langueDuChoix(choix: ChoixLangue, etiquetteSysteme: string | null | undefined): Langue {
	if (choix === 'systeme') return langueDuSysteme(etiquetteSysteme);
	return choix;
}
