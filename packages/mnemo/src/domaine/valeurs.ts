/** Vrai pour une table de clés (objet simple, ni tableau ni null). */
export function estObjet(valeur: unknown): valeur is Record<string, unknown> {
	return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur);
}
