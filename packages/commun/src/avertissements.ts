/**
 * Succès d'une écriture faite, avec ce qu'il faut en savoir sans l'annuler : un échec après elle (index pas mis à jour…), une
 * extraction incomplète, un document qui ne sera pas cherchable. Jamais présenté comme un échec, sinon un client qui
 * réessaie écrit un doublon.
 */
export type AvecAvertissements = { avertissements?: string[] };

/** Le champ facultatif d'une liste d'avertissements : absent quand elle est vide. */
export function avecAvertissements(liste: readonly string[]): AvecAvertissements {
	return liste.length === 0 ? {} : { avertissements: [...liste] };
}

/**
 * `T` si l'un de ses genres porte le champ `avertissements` (liste de textes), sinon `never` : un résultat dont le champ est
 * mal nommé (`avis`…) ne passe pas la vérification des types.
 */
export type PortantAvertissements<T> = true extends (T extends unknown ? ('avertissements' extends keyof T ? (T extends AvecAvertissements ? true : false) : false) : never) ? T : never;

/** Les avertissements d'un résultat (un genre au moins peut en porter), à recopier dans une réponse : `{}` s'il n'en a pas. */
export function avertissementsDe<T extends object>(r: T & PortantAvertissements<T>): AvecAvertissements {
	const liste = 'avertissements' in r && Array.isArray(r.avertissements) ? r.avertissements.filter((a): a is string => typeof a === 'string') : [];
	return avecAvertissements(liste);
}

/** Un avertissement tel qu'il est montré à une personne. */
export const ligneAvertissement = (avertissement: string): string => `Avertissement : ${avertissement}`;
