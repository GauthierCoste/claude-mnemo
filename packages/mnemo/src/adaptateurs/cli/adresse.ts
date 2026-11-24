import { REGLAGES_PAR_DEFAUT } from '../../domaine/reglages.ts';
import { ErreurCli } from './erreurs.ts';

/**
 * Port et adresses du service. Le port est fixe (réglage `service.port`, 4747 par défaut, ou `MNEMO_PORT`) pour que l'adresse
 * de l'interface ne change pas : un favori, l'application installée (PWA) et le lanceur macOS restent valables d'un démarrage
 * à l'autre.
 */

/**
 * Port demandé : `MNEMO_PORT` (0 : un port libre, l'adresse change à chaque démarrage — pour les essais), sinon le réglage
 * `service.port` du dossier (`portRegle`).
 */
export function portDemande(env: Record<string, string | undefined> = process.env, portRegle = REGLAGES_PAR_DEFAUT.service.port): number {
	const brut = env.MNEMO_PORT;
	if (brut === undefined || !portFixe(env)) return portRegle;
	if (!/^\d+$/u.test(brut) || Number(brut) > 65535) throw new ErreurCli(`MNEMO_PORT invalide : « ${brut} » (0 à 65535 ; 0 : un port libre).`, 2);
	return Number(brut);
}

/** `MNEMO_PORT` posé (non vide) : il l'emporte sur le réglage `service.port`. */
export const portFixe = (env: Record<string, string | undefined> = process.env): boolean => env.MNEMO_PORT !== undefined && env.MNEMO_PORT !== '';

/** Adresse de l'interface, sans jeton : celle à garder en favori, une fois le jeton gardé par le navigateur. */
export const adresseDuService = (port: number | '<port>'): string => `http://127.0.0.1:${port}/`;

/**
 * Adresse de première ouverture dans un navigateur : le jeton est dans le fragment (jamais envoyé sur le réseau) ; l'interface
 * le garde pour son origine (`localStorage`), puis le retire de la barre d'adresse.
 */
export const adresseAvecJeton = (port: number | '<port>', jeton: string): string => `${adresseDuService(port)}#jeton=${jeton}`;
