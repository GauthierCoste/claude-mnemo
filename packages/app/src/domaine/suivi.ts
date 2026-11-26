/**
 * Suivi du service par l'app, en une fonction pure de la suite des événements : la vie du service (`vie-service.ts`), la
 * liste des sessions tenue par les messages du WebSocket (`sessions.ts`) et les notifications à montrer
 * (`notifications.ts`). L'infrastructure ne fait que traduire ce qu'elle observe en événements et exécuter l'action rendue.
 *
 * La liste des sessions survit à une coupure du WebSocket (aucun événement ne la vide) : le premier `sessions` reçu après
 * la reconnexion la remplace, et une session qui attendait déjà n'est pas notifiée de nouveau. Elle est oubliée, avec le
 * suivi des notifications, quand le service n'est plus là (arrêté, tombé, en démarrage, en erreur) : le premier instantané
 * d'un service neuf est un état initial, sans notification.
 */
import type { MessageServeur, SessionVue } from '@mnemo/contrat';
import { type NotificationSession, notificationsAEmettre, SUIVI_INITIAL, type SuiviNotifications } from './notifications.ts';
import { appliquerMessage } from './sessions.ts';
import { type ActionService, type EvenementService, evoluerVie, VIE_INITIALE, type VieService } from './vie-service.ts';

/** `sessions` : null tant qu'aucune liste n'a été reçue du service courant. */
export type EtatSuivi = { vie: VieService; sessions: readonly SessionVue[] | null; notifications: SuiviNotifications };

export type EvenementSuivi =
	| EvenementService
	/** Message du WebSocket ; `fenetreAuFocus` : la fenêtre de l'app a le focus à sa réception. */
	| { type: 'message'; message: MessageServeur; fenetreAuFocus: boolean };

export type ResultatSuivi = { etat: EtatSuivi; action: ActionService; notifications: NotificationSession[] };

export const SUIVI_APP_INITIAL: EtatSuivi = { vie: VIE_INITIALE, sessions: null, notifications: SUIVI_INITIAL };

/** Le service est là (ses sessions valent encore) : vivant, ou en arrêt tant que son processus n'est pas mort. */
const serviceLa = (vie: VieService): boolean => vie.etat === 'vivant' || vie.etat === 'arret';

export function evoluerSuivi(etat: EtatSuivi, evenement: EvenementSuivi): ResultatSuivi {
	if (evenement.type === 'message') {
		// un message d'un service qu'on ne tient pas pour vivant (reste d'une connexion) est ignoré
		if (etat.vie.etat !== 'vivant') return { etat, action: null, notifications: [] };
		const sessions = appliquerMessage(etat.sessions, evenement.message);
		if (sessions === etat.sessions || sessions === null) return { etat, action: null, notifications: [] };
		const r = notificationsAEmettre(etat.notifications, sessions, evenement.fenetreAuFocus);
		return { etat: { ...etat, sessions, notifications: r.suivi }, action: null, notifications: r.notifications };
	}
	const { vie, action } = evoluerVie(etat.vie, evenement);
	if (serviceLa(vie)) return { etat: { ...etat, vie }, action, notifications: [] };
	return { etat: { vie, sessions: null, notifications: SUIVI_INITIAL }, action, notifications: [] };
}
