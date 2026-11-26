/**
 * Plateformes de l'app de bureau : macOS et Windows. Ce qui en dépend dans le domaine la reçoit en donnée (testé sous macOS
 * avec `'win32'` explicite) ; `process.platform` n'est lu que par `infra/`, `electron/` et le preload de l'assistant (qui la
 * donne à la page).
 */

export type PlateformeApp = 'darwin' | 'win32';

/** La plateforme de l'app d'après `process.platform` : Windows, sinon macOS. */
export function plateformeApp(plateforme: string): PlateformeApp {
	return plateforme === 'win32' ? 'win32' : 'darwin';
}

/**
 * Deux chemins désignent-ils le même fichier ? Sous Windows, sans tenir compte de la casse ni du sens des séparateurs
 * (`C:\Program Files\…` et `c:/program files/…`) ; sous macOS, à l'identique.
 */
export function memeChemin(a: string, b: string, plateforme: PlateformeApp): boolean {
	if (plateforme !== 'win32') return a === b;
	const normal = (c: string) => c.replaceAll('/', '\\').toLowerCase();
	return normal(a) === normal(b);
}
