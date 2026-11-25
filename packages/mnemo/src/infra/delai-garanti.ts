/** Marge au-delà du délai donné à la commande : son propre minuteur a d'abord sa chance. */
export const MARGE_DELAI_MS = 1000;

/**
 * `promesse`, ou `repli` si elle n'a pas abouti dans `ms` : un délai tenu même quand l'exécuteur ne tient pas le sien
 * (exécuteur de test, processus qui ne se termine pas). Le minuteur est effacé ensuite et ne retient pas le processus.
 */
export function avecDelaiGaranti<T>(promesse: Promise<T>, ms: number, repli: T): Promise<T> {
	let minuteur: ReturnType<typeof setTimeout> | undefined;
	const delai = new Promise<T>((resoudre) => {
		minuteur = setTimeout(() => resoudre(repli), ms);
		minuteur.unref?.();
	});
	return Promise.race([promesse, delai]).finally(() => clearTimeout(minuteur));
}
