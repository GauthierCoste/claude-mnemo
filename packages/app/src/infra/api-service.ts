/**
 * Les deux routes de l'API du service dont l'app a besoin : `GET /api/sante` (vie du service, jeton) et `POST /api/arret`
 * (arrêt propre, comme `mnemo arreter`). `node:http` sur 127.0.0.1, `Authorization: Bearer <jeton>`, sans en-tête
 * `Origin` (le service accepte une requête sans `Origin`, comme celles de la ligne de commande).
 */
import { request } from 'node:http';
import { ROUTES } from '@mnemo/contrat';
import { TEXTES_FR, type TextesApp } from '../domaine/langue/textes.ts';
import type { ServiceLocal } from './service-local.ts';

export type ReponseLocale = { statut: number } | { echec: 'refusee' | 'delai' | 'autre' };

/** Délai d'une réponse de `sante`, comme `serviceVivant` de la CLI. */
export const DELAI_SANTE_MS = 2000;
/** Délai de la réponse de `POST /api/arret` (le service répond avant de s'arrêter), comme `mnemo arreter`. */
export const DELAI_ARRET_MS = 5000;

/** Requête au service local ; le corps de la réponse est lu puis ignoré. Jamais d'exception. */
export function requeteLocale(port: number, methode: 'GET' | 'POST' | 'PUT' | 'DELETE', chemin: string, jeton: string, delaiMs: number, corps?: unknown): Promise<ReponseLocale> {
	return new Promise((resoudre) => {
		const donnees = corps === undefined ? undefined : JSON.stringify(corps);
		const entetes: Record<string, string> = { Authorization: `Bearer ${jeton}` };
		if (donnees !== undefined) {
			entetes['Content-Type'] = 'application/json';
			entetes['Content-Length'] = String(Buffer.byteLength(donnees));
		}
		let fini = false;
		const finir = (r: ReponseLocale): void => {
			if (fini) return;
			fini = true;
			clearTimeout(minuteur);
			resoudre(r);
		};
		const req = request({ host: '127.0.0.1', port, method: methode, path: chemin, headers: entetes }, (res) => {
			res.resume();
			res.on('end', () => finir({ statut: res.statusCode ?? 0 }));
			res.on('error', () => finir({ statut: res.statusCode ?? 0 }));
		});
		const minuteur = setTimeout(() => {
			finir({ echec: 'delai' });
			req.destroy();
		}, delaiMs);
		req.on('error', (e: NodeJS.ErrnoException) => finir({ echec: e.code === 'ECONNREFUSED' ? 'refusee' : 'autre' }));
		req.end(donnees);
	});
}

/** `ok` : le service répond avec ce jeton ; `refuse` : il répond mais refuse le jeton ; `absent` : pas de réponse. */
export type Sante = 'ok' | 'refuse' | 'absent';

export async function santeService(s: Pick<ServiceLocal, 'port' | 'jeton'>, delaiMs: number = DELAI_SANTE_MS): Promise<Sante> {
	const r = await requeteLocale(s.port, 'GET', ROUTES.sante, s.jeton, delaiMs);
	if ('echec' in r) return 'absent';
	if (r.statut === 200) return 'ok';
	return r.statut === 401 ? 'refuse' : 'absent';
}

/**
 * Suite de `POST /api/arret`, comme `suiteDeLaDemande` de `mnemo arreter` : `accepte` (202) ; `signal` (connexion refusée,
 * ou route inconnue : SIGTERM au processus) ; `attendre` (pas de réponse : la demande a pu arriver, pas de second arrêt) ;
 * `refus` (autre statut).
 */
export type SuiteArret = 'accepte' | 'signal' | 'attendre' | { refus: string };

export function suiteDeLaDemande(r: ReponseLocale, t: TextesApp = TEXTES_FR): SuiteArret {
	if ('echec' in r) return r.echec === 'refusee' ? 'signal' : 'attendre';
	if (r.statut === 202) return 'accepte';
	if (r.statut === 404) return 'signal';
	return { refus: t.service.arretRefuse(r.statut) };
}

export async function demanderArret(s: Pick<ServiceLocal, 'port' | 'jeton'>, t: TextesApp = TEXTES_FR): Promise<SuiteArret> {
	return suiteDeLaDemande(await requeteLocale(s.port, 'POST', ROUTES.arret, s.jeton, DELAI_ARRET_MS, {}), t);
}
