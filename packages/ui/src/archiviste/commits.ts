/** Mise en forme des commits du fil : heure locale, message sans le préfixe commun des écritures. */

const deux = (n: number) => String(n).padStart(2, '0');

/** Heure locale HH:MM d'un instant. */
export function heure(ms: number): string {
	const d = new Date(ms);
	return `${deux(d.getHours())}:${deux(d.getMinutes())}`;
}

/** Message d'un commit sans le préfixe `mnemo: ` de toutes les écritures. */
export function messageCourt(message: string): string {
	return message.replace(/^mnemo:\s*/, '');
}
