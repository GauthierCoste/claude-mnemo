/**
 * Session demandée par l'adresse : une app de bureau ouvre la fenêtre sur `/#session=<id>` (avec `jeton=<jeton>` au premier
 * chargement : `#jeton=…&session=…`, dans un ordre libre), puis, fenêtre ouverte, ne change que le fragment. Le jeton se lit
 * à part (`jeton.ts`) ; le fragment est effacé de l'adresse une fois lu.
 */

const LONGUEUR_MAX = 200;

/** L'id de session du fragment (`session=<id>`, autres clés ignorées) ; null s'il n'y en a pas, vide ou trop long. */
export function lireSessionDuFragment(hash: string): string | null {
	const id = new URLSearchParams(hash.replace(/^#/, '')).get('session')?.trim() ?? '';
	return id !== '' && id.length <= LONGUEUR_MAX ? id : null;
}
