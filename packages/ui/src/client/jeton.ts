/**
 * Jeton du service dans le navigateur. À la première ouverture, l'adresse le porte dans son fragment (`#jeton=<64 hex>`,
 * jamais envoyé sur le réseau) : l'interface le range dans le `localStorage` de son origine — isolé par port, jamais envoyé
 * de lui-même (contrairement à un cookie, que le navigateur joindrait aussi aux autres ports de 127.0.0.1) —, le retire de
 * la barre d'adresse, puis le présente elle-même : `Authorization` pour l'API, sous-protocole pour le WebSocket. Ensuite
 * l'adresse fixe suffit. Un jeton refusé (renouvelé) est effacé : l'écran du jeton s'affiche.
 */

const CLE = 'mnemo.jeton';
const FORME = /^[0-9a-f]{64}$/;

export type Stockage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Le jeton du fragment (rangé dans le stockage), sinon celui du stockage ; null s'il n'y en a pas de bonne forme. */
export function lireJeton(hash: string, stockage: Stockage | null): string | null {
	const duFragment = new URLSearchParams(hash.replace(/^#/, '')).get('jeton');
	if (duFragment !== null && FORME.test(duFragment)) {
		try {
			stockage?.setItem(CLE, duFragment);
		} catch {
			// Stockage bloqué : le jeton vaut pour cette page seulement.
		}
		return duFragment;
	}
	try {
		const garde = stockage?.getItem(CLE) ?? null;
		return garde !== null && FORME.test(garde) ? garde : null;
	} catch {
		return null;
	}
}

/** Remplace l'adresse affichée par la même sans fragment (chemin et requête gardés) : le jeton ne reste pas à l'écran. */
export function effacerJetonDeLAdresse(h: Pick<History, 'replaceState'>, adresse: string): void {
	const url = new URL(adresse);
	h.replaceState(null, '', url.pathname + url.search);
}

/** Efface le jeton gardé (refusé par le service) : un rechargement ne le réessaie pas. */
export function oublierJeton(stockage: Pick<Storage, 'removeItem'> | null): void {
	try {
		stockage?.removeItem(CLE);
	} catch {
		// Stockage bloqué : rien à effacer.
	}
}
