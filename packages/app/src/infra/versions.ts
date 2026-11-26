/**
 * Dernière version publiée de Mnemo : une requête HTTPS anonyme à l'API de GitHub Releases, sans cookie ni identifiant, avec
 * un `User-Agent` générique (l'API le demande) ; rien d'autre n'est envoyé. Tout échec (réseau, délai, réponse refusée ou
 * illisible) : null, en silence.
 */
import { ADRESSE_DERNIERE_VERSION, lireDerniereVersion, type VersionPubliee } from '../domaine/version.ts';

export const DELAI_VERSION_MS = 10_000;

export type Telecharger = (url: string, init: RequestInit) => Promise<Response>;

export async function derniereVersionPubliee(telecharger: Telecharger = fetch, delaiMs: number = DELAI_VERSION_MS): Promise<VersionPubliee | null> {
	try {
		const reponse = await telecharger(ADRESSE_DERNIERE_VERSION, {
			headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Mnemo' },
			credentials: 'omit',
			redirect: 'error',
			signal: AbortSignal.timeout(delaiMs),
		});
		if (!reponse.ok) return null;
		return lireDerniereVersion(await reponse.json());
	} catch {
		return null;
	}
}
