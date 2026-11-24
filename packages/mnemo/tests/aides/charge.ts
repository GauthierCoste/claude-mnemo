/**
 * Tolérance des tests de durée : la machine peut être chargée (CI, agents en parallèle, applications de l'utilisateur).
 * `CI` défini ou `MNEMO_TESTS_LENTS=1` : ×3 ; sinon ×1.
 */
export const TOLERANCE = process.env.CI || process.env.MNEMO_TESTS_LENTS === '1' ? 3 : 1;

/** Borne de durée (ms) multipliée par la tolérance. */
export const borne = (ms: number): number => ms * TOLERANCE;

/** Durée (ms) d'un appel. */
export function duree(f: () => unknown): number {
	const debut = performance.now();
	f();
	return performance.now() - debut;
}

/** Médiane de `essais` mesures (3 par défaut) : un à-coup de la machine ne fausse pas le résultat. */
export function mediane(f: () => unknown, essais = 3): number {
	const mesures = Array.from({ length: essais }, () => duree(f)).sort((a, b) => a - b);
	return mesures[Math.floor(mesures.length / 2)]!;
}

/** Durée minimale (ms) d'une mesure de taille `n` : en dessous, le bruit de la machine domine le rapport. */
const MESURABLE_MS = 25;
/** Taille maximale (caractères) d'une entrée mesurée : au-delà, la pile des expressions régulières de V8 peut déborder. */
const TAILLE_MAX_MESUREE = 3_000_000;

/** Rapport au-delà duquel la mesure est refaite (linéaire : proche de 2). */
const SOUPCON = 2.5;

/**
 * Croissance d'un traitement. `ms2n` : médiane pour une entrée de taille `2n` (la borne absolue s'y applique). `rapport` :
 * médiane(2m) / médiane(m), où `m` part de `n` et double tant que la mesure de `m` reste sous `MESURABLE_MS` (entrée de
 * `2m` : 3 Mo au plus).
 * Linéaire : proche de 2 ; quadratique : proche de 4. Rapport douteux (au-delà de `SOUPCON`) : mesuré de nouveau (médianes
 * de 5), la plus petite valeur est gardée. `entree(k)` construit l'entrée hors mesure.
 */
export function croissance(entree: (n: number) => string, traiter: (texte: string) => unknown, n: number): { rapport: number; ms2n: number } {
	const deN = entree(2 * n);
	traiter(deN); // chauffe (compilation à la volée)
	const ms2n = mediane(() => traiter(deN));
	let m = n;
	let petit = entree(m);
	let msM = mediane(() => traiter(petit));
	while (msM < MESURABLE_MS && petit.length * 4 <= TAILLE_MAX_MESUREE) {
		m *= 2;
		petit = entree(m);
		msM = mediane(() => traiter(petit));
	}
	const grand = entree(2 * m);
	const rapport = mediane(() => traiter(grand)) / Math.max(msM, 1);
	if (rapport < SOUPCON) return { rapport, ms2n };
	// Un à-coup de la machine (agents en parallèle, compilation) peut gonfler un rapport linéaire : une seconde série, plus
	// longue, et la plus petite des deux. Un traitement quadratique reste proche de 4 aux deux.
	const second = mediane(() => traiter(grand), 5) / Math.max(mediane(() => traiter(petit), 5), 1);
	return { rapport: Math.min(rapport, second), ms2n };
}
