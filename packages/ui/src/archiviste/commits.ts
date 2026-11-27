/** Mise en forme des commits du fil : le message sans le préfixe commun des écritures (l'heure : `t.commun.formats.heure`). */

/** Message d'un commit sans le préfixe `mnemo: ` de toutes les écritures. */
export function messageCourt(message: string): string {
	return message.replace(/^mnemo:\s*/, '');
}
