// Coupe d'un classement journalisé (spec classement vivant § 9.2). Pur.

/**
 * Les `max` premières lignes d'un classement ; la dernière gardée compte toutes les coupées (`coupees`, ajouté à celles qu'elle
 * comptait déjà). Inchangé s'il n'a pas plus de `max` lignes.
 */
export function couperClassement<T extends { coupees?: number }>(classement: readonly T[], max: number): T[] {
	if (classement.length <= max || max <= 0) return classement.slice(0, Math.max(0, max));
	const dejaCoupees = classement.at(-1)?.coupees ?? 0;
	const gardees = classement.slice(0, max).map((l) => {
		const { coupees: _coupees, ...reste } = l;
		return reste as T;
	});
	gardees[max - 1] = { ...gardees[max - 1]!, coupees: dejaCoupees + classement.length - max };
	return gardees;
}
