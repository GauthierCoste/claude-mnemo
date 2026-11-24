import { createHash, timingSafeEqual } from 'node:crypto';
import { PREFIXE_JETON_WS } from '@mnemo/contrat';

/**
 * Défenses du service local : un jeton aléatoire (`.mnemo/jeton`) exigé partout, comparé en temps
 * constant ; `Host` limité à l'adresse du service (contre le DNS rebinding) ; `Origin` du WebSocket limité à elle (une page
 * étrangère ouverte dans le navigateur ne s'y branche pas) ; aucun cookie : le jeton est toujours présenté par le client
 * lui-même (`Authorization`, sous-protocole ou `?jeton=`), jamais par le navigateur de son propre chef ; en-têtes qui
 * interdisent tout contenu venu d'ailleurs.
 */

const empreinte = (texte: string): Buffer => createHash('sha256').update(texte, 'utf8').digest();

/**
 * Le jeton reçu est-il celui du service ? Comparaison en temps constant, aussi pour la longueur : on compare les empreintes
 * SHA-256 (même taille), puis les longueurs. Absent ou vide : faux.
 */
export function jetonValide(recu: string | null | undefined, attendu: string): boolean {
	if (typeof recu !== 'string' || recu === '') return false;
	const egal = timingSafeEqual(empreinte(recu), empreinte(attendu));
	return egal && recu.length === attendu.length;
}

/** `Bearer <jeton>` d'un en-tête `Authorization`, ou null. */
export function jetonDeLEntete(autorisation: string | undefined): string | null {
	if (autorisation === undefined) return null;
	const m = /^Bearer\s+(\S+)\s*$/iu.exec(autorisation);
	return m === null ? null : m[1]!;
}

/** `Host` doit valoir `127.0.0.1:<port>` ou `localhost:<port>` (casse du nom ignorée). */
export function hoteValide(hote: string | undefined, port: number): boolean {
	if (hote === undefined) return false;
	const net = hote.toLowerCase();
	return net === `127.0.0.1:${port}` || net === `localhost:${port}`;
}

/**
 * `Origin` (API et WebSocket) : absente (client en ligne de commande), ou exactement l'adresse sous laquelle le service a été
 * joint (`http://` + `Host`, déjà vérifié) : une page servie par `localhost` ne parle pas à `127.0.0.1`, et inversement.
 */
export function origineValide(origine: string | undefined, hote: string): boolean {
	if (origine === undefined) return true;
	return origine.toLowerCase() === `http://${hote.toLowerCase()}`;
}

/**
 * Jeton présenté à l'ouverture du WebSocket : le sous-protocole `mnemo.jeton.<jeton>` (interface : un navigateur ne peut pas
 * poser d'en-tête `Authorization` sur un WebSocket, et une adresse se retrouve dans les journaux), sinon `?jeton=` (ligne de
 * commande). Null s'il n'y en a pas.
 */
export function jetonDuWebSocket(protocoles: string | undefined, parametre: string | null): string | null {
	for (const p of (protocoles ?? '').split(',')) {
		const net = p.trim();
		if (net.startsWith(PREFIXE_JETON_WS)) return net.slice(PREFIXE_JETON_WS.length);
	}
	return parametre;
}

/** Portés par chaque réponse HTTP du service. Aucune en-tête CORS : aucune autre origine n'est permise. */
export const ENTETES_SECURITE: Readonly<Record<string, string>> = {
	'content-security-policy': "default-src 'self'",
	'x-content-type-options': 'nosniff',
	'referrer-policy': 'no-referrer',
	'cross-origin-resource-policy': 'same-origin',
	'cache-control': 'no-store',
};
