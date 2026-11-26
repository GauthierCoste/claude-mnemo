/**
 * Notifications : une par session qui passe à « attend une réponse » alors que la fenêtre n'a pas le focus. Jamais
 * répétée tant que la session n'a pas quitté cet état ; aucune pour le premier instantané reçu (l'état initial n'est pas
 * un passage). Le suivi retient, d'un instantané à l'autre, les sessions qui attendaient.
 */
import type { SessionVue } from '@mnemo/contrat';
import { attendReponse, libelleSession } from './sessions.ts';

/** Ids des sessions qui attendaient une réponse au dernier instantané ; null : aucun instantané reçu encore. */
export type SuiviNotifications = ReadonlySet<string> | null;

export type NotificationSession = { session: string; titre: string; corps: string };

export const SUIVI_INITIAL: SuiviNotifications = null;

/**
 * Notifications à montrer pour un nouvel instantané des sessions, et le suivi mis à jour. La fenêtre au premier plan : le
 * passage est vu, rien n'est montré (et il ne le sera pas plus tard).
 */
export function notificationsAEmettre(
	suivi: SuiviNotifications,
	sessions: readonly SessionVue[],
	fenetreAuFocus: boolean,
): { suivi: ReadonlySet<string>; notifications: NotificationSession[] } {
	const attendent = sessions.filter(attendReponse);
	const nouveau = new Set(attendent.map((s) => s.id));
	if (suivi === null || fenetreAuFocus) return { suivi: nouveau, notifications: [] };
	const notifications = attendent.filter((s) => !suivi.has(s.id)).map((s) => ({ session: s.id, titre: 'Mnemo', corps: `${libelleSession(s)} attend ta réponse` }));
	return { suivi: nouveau, notifications };
}
