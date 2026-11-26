/**
 * État agrégé de l'app (icône de la barre des menus, infobulle, menu) : la vie du service, puis l'état de ses sessions.
 */
import type { SessionVue } from '@mnemo/contrat';
import { attendReponse } from './sessions.ts';
import type { EtatVie } from './vie-service.ts';

export type EtatAgrege = 'arrete' | 'demarrage' | 'arret' | 'erreur' | 'attend' | 'travaille' | 'repos';

/**
 * Service arrêté, en démarrage, en arrêt ou en erreur : cet état. Vivant : `attend` si au moins une session attend une réponse,
 * sinon `travaille` si au moins une travaille, sinon `repos`.
 */
export function etatAgrege(vie: EtatVie, sessions: readonly SessionVue[]): EtatAgrege {
	if (vie !== 'vivant') return vie;
	if (sessions.some(attendReponse)) return 'attend';
	if (sessions.some((s) => s.etat === 'travaille')) return 'travaille';
	return 'repos';
}
