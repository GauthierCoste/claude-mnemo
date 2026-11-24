import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as FluxWeb } from 'node:stream/web';

export type OptionsTelechargement = {
	/** Refuse toute adresse (et toute redirection) qui n'est pas en https. Vrai par défaut ; faux seulement dans les tests. */
	httpsSeulement?: boolean;
	/** Abandon si aucun octet n'arrive pendant ce délai (60 s par défaut). Pas de délai total : un gros modèle peut être long. */
	delaiInactiviteMs?: number;
	/** Appelé à chaque morceau reçu ; `total` est `null` si le serveur ne donne pas la taille. */
	progression?: (recu: number, total: number | null) => void;
	/** `fetch` utilisé (le global par défaut) ; remplaçable dans les tests seulement. */
	fetch?: typeof fetch;
};

const REDIRECTIONS_MAX = 10;
const DELAI_INACTIVITE_MS = 60_000;

function verifierAdresse(adresse: URL, httpsSeulement: boolean): void {
	if (adresse.protocol === 'https:') return;
	if (adresse.protocol === 'http:' && !httpsSeulement) return;
	throw new Error(`Adresse refusée : seul https est accepté (${adresse.protocol.replace(/:$/u, '')}://${adresse.host}).`);
}

const CODES_RESEAU = new Set(['ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);

/** Erreurs de `fetch`/undici (« fetch failed », « terminated », codes `UND_ERR_*` ou réseau) ; jamais une erreur disque. */
function erreurReseau(erreur: unknown): boolean {
	if (erreur instanceof TypeError && (erreur.message === 'terminated' || erreur.message === 'fetch failed')) return true;
	for (let e: unknown = erreur, n = 0; e instanceof Error && n < 4; e = e.cause, n++) {
		const code = (e as { code?: unknown }).code;
		if (typeof code === 'string' && (code.startsWith('UND_ERR_') || CODES_RESEAU.has(code))) return true;
	}
	return false;
}

/**
 * Télécharge `url` en flux dans `vers` (créé, jamais écrasé) et rend son SHA-256, calculé au fil de l'eau. Les redirections
 * sont suivies à la main pour que chaque saut respecte `httpsSeulement`. Tout échec retire le fichier partiel.
 */
export async function telechargerFichier(url: string, vers: string, options: OptionsTelechargement = {}): Promise<string> {
	const httpsSeulement = options.httpsSeulement ?? true;
	const delai = options.delaiInactiviteMs ?? DELAI_INACTIVITE_MS;
	const controleur = new AbortController();
	let minuteur: NodeJS.Timeout | undefined;
	const rearmer = () => {
		clearTimeout(minuteur);
		minuteur = setTimeout(() => controleur.abort(new Error(`Téléchargement abandonné : aucune donnée depuis ${Math.round(delai / 1000)} s (${url}).`)), delai);
	};
	let ecrit = false;
	try {
		let adresse = new URL(url);
		let reponse: Response | undefined;
		for (let saut = 0; saut <= REDIRECTIONS_MAX; saut++) {
			verifierAdresse(adresse, httpsSeulement);
			rearmer();
			// `identity` : octets reçus = octets du fichier (empreinte et taille comparables, pas de décompression).
			reponse = await (options.fetch ?? fetch)(adresse, { redirect: 'manual', signal: controleur.signal, headers: { 'accept-encoding': 'identity' } });
			const suite = reponse.headers.get('location');
			if (reponse.status >= 300 && reponse.status < 400 && suite !== null) {
				await reponse.body?.cancel();
				adresse = new URL(suite, adresse);
				reponse = undefined;
				continue;
			}
			break;
		}
		if (reponse === undefined) throw new Error(`Téléchargement refusé : plus de ${REDIRECTIONS_MAX} redirections (${url}).`);
		if (!reponse.ok || reponse.body === null) {
			await reponse.body?.cancel();
			throw new Error(`Téléchargement refusé : HTTP ${reponse.status} pour ${url}.`);
		}
		const longueur = Number(reponse.headers.get('content-length'));
		const total = Number.isSafeInteger(longueur) && longueur > 0 ? longueur : null;
		const empreinte = createHash('sha256');
		let recu = 0;
		const sortie = createWriteStream(vers, { flags: 'wx', mode: 0o600 });
		ecrit = true;
		await pipeline(
			Readable.fromWeb(reponse.body as FluxWeb<Uint8Array>, { signal: controleur.signal }),
			async function* (morceaux: AsyncIterable<Buffer>) {
				for await (const morceau of morceaux) {
					rearmer();
					empreinte.update(morceau);
					recu += morceau.length;
					options.progression?.(recu, total);
					yield morceau;
				}
			},
			sortie,
		);
		if (total !== null && recu !== total) throw new Error(`Téléchargement incomplet : ${recu} octets reçus sur ${total} (${url}).`);
		return empreinte.digest('hex');
	} catch (erreur) {
		if (ecrit) await rm(vers, { force: true });
		// Une interruption par le minuteur remonte comme « aborted » : rendre le motif lisible.
		if (controleur.signal.aborted && controleur.signal.reason instanceof Error) throw controleur.signal.reason;
		if (erreurReseau(erreur)) throw new Error(`Téléchargement interrompu (connexion coupée) : ${url}.`, { cause: erreur });
		throw erreur;
	} finally {
		clearTimeout(minuteur);
	}
}
