/** Vrai pour une table de clés (objet simple, ni tableau ni null). */
export function estObjet(valeur: unknown): valeur is Record<string, unknown> {
	return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur);
}

/** Une table de clés lue dans un texte JSON ; null s'il est illisible ou n'en est pas une. */
export function objetJson(texte: string): Record<string, unknown> | null {
	try {
		const lu: unknown = JSON.parse(texte);
		return estObjet(lu) ? lu : null;
	} catch {
		return null;
	}
}
