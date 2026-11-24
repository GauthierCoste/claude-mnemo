/** Paramètres d'une route à liste bornée (`documents`, `fiche`) qui demandent la liste entière, à ajouter à ceux de la route. */
export const PARAMETRES_TOUT = { tout: '1' } as const;

/** Vrai si les paramètres d'une requête (`lire` : la valeur d'un paramètre, absente sinon) demandent la liste entière. */
export const demandeTout = (lire: (cle: string) => string | null | undefined): boolean => Object.entries(PARAMETRES_TOUT).every(([cle, valeur]) => lire(cle) === valeur);
