/**
 * Forme d'une liste de textes, tirée de la liste française : mêmes clés, une chaîne pour une chaîne, une fonction aux mêmes
 * paramètres pour une fonction. Une liste typée `Forme<typeof fr>` qui oublie une clé, en ajoute une ou change des
 * paramètres ne passe pas `tsc`.
 */
export type Forme<T> = {
	readonly [K in keyof T]: T[K] extends string ? string : T[K] extends (...parametres: infer P) => infer R ? (...parametres: P) => R : Forme<T[K]>;
};
