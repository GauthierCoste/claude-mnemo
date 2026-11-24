import { request } from 'node:http';

/** Taille maximale d'une réponse d'un serveur de modèle (150 vecteurs de 1024 nombres en JSON tiennent largement). */
const REPONSE_MAX = 64 * 1024 * 1024;

export type ReponseLocale = { statut: number; corps: unknown };

/** Pourquoi une requête locale n'a pas de réponse : `refusee` (personne n'écoute), `delai`, `interrompue`, `trop-grosse`. */
export type EchecLocal = { echec: 'refusee' | 'delai' | 'interrompue' | 'trop-grosse' };

type OptionsRequete = { cle: string | null; finMs: number; corps?: unknown };

/**
 * Requête JSON vers `127.0.0.1:<port>` avec la clé du serveur (`null` : sans clé), abandonnée à `finMs` (horloge `Date.now()`). Sans connexion
 * gardée ouverte (un processus court ne reste pas en vie pour elle). Rend null en cas d'échec réseau, de délai dépassé, de
 * réponse trop grosse ; `corps` vaut `undefined` si la réponse n'est pas du JSON.
 */
export async function requeteLocale(port: number, chemin: string, options: OptionsRequete): Promise<ReponseLocale | null> {
	const r = await requeteLocaleDetaillee(port, chemin, options);
	return 'echec' in r ? null : r;
}

/** `requeteLocale`, avec la raison de l'échec. */
export function requeteLocaleDetaillee(port: number, chemin: string, options: OptionsRequete): Promise<ReponseLocale | EchecLocal> {
	const reste = options.finMs - Date.now();
	if (reste <= 0) return Promise.resolve({ echec: 'delai' });
	return new Promise((resoudre) => {
		let fini = false;
		const terminer = (resultat: ReponseLocale | EchecLocal): void => {
			if (fini) return;
			fini = true;
			clearTimeout(minuteur);
			resoudre(resultat);
		};
		const corps = options.corps === undefined ? undefined : Buffer.from(JSON.stringify(options.corps));
		const req = request(
			{
				host: '127.0.0.1',
				port,
				path: chemin,
				method: corps === undefined ? 'GET' : 'POST',
				agent: false,
				headers: {
					...(options.cle === null ? {} : { authorization: `Bearer ${options.cle}` }),
					connection: 'close',
					...(corps === undefined ? {} : { 'content-type': 'application/json', 'content-length': corps.byteLength }),
				},
			},
			(res) => {
				const morceaux: Buffer[] = [];
				let taille = 0;
				res.on('data', (m: Buffer) => {
					taille += m.byteLength;
					if (taille > REPONSE_MAX) {
						req.destroy();
						terminer({ echec: 'trop-grosse' });
					} else morceaux.push(m);
				});
				res.on('end', () => {
					let lu: unknown;
					try {
						lu = JSON.parse(Buffer.concat(morceaux).toString('utf8'));
					} catch {
						lu = undefined;
					}
					terminer({ statut: res.statusCode ?? 0, corps: lu });
				});
				res.on('error', () => terminer({ echec: 'interrompue' }));
			},
		);
		const minuteur = setTimeout(() => {
			req.destroy();
			terminer({ echec: 'delai' });
		}, reste);
		req.on('error', (e: NodeJS.ErrnoException) => terminer({ echec: e.code === 'ECONNREFUSED' ? 'refusee' : 'interrompue' }));
		req.end(corps);
	});
}
